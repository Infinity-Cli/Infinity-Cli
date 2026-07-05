"""FastAPI application for Infinity CLI server."""

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException

from inf.bridge.tool_client import ToolClient
from inf.core.config import load_settings
from inf.core.orchestrator import Orchestrator
from inf.models.router import ModelRouter
from inf.persistence.db import Database
from inf.persistence.models import ExecutionLog, RuntimeStatus, Task
from inf.persistence.repositories import ExecutionLogRepository, TaskRepository
from inf.providers.factory import get_provider


class RunRequest(BaseModel):
    """Request model for /run endpoint."""

    goal: str
    max_agents: int = Field(default=10, ge=1, le=50)
    timeout: int = Field(default=3600, ge=60, le=86400)
    enable_sync: bool = False
    sync_base_url: Optional[str] = None


class RunResponse(BaseModel):
    """Response model for /run endpoint."""

    success: bool
    goal: str
    run_id: str
    completed: list[str]
    failed: list[str]


class AskRequest(BaseModel):
    """Request model for /ask endpoint."""

    prompt: str
    provider: str | None = None
    model: str | None = None


class AskResponse(BaseModel):
    """Response model for /ask endpoint."""

    response: str


class HealthResponse(BaseModel):
    """Response model for /health endpoint."""

    status: str


class ToolExecuteRequest(BaseModel):
    """Request model for /tools/execute endpoint."""

    tool: str
    input: dict = Field(default_factory=dict)


class ToolExecuteResponse(BaseModel):
    """Response model for /tools/execute endpoint."""

    success: bool
    output: Optional[str] = None
    error: Optional[str] = None
    data: Optional[Any] = None


app = FastAPI(title="Infinity CLI Server", version="0.1.0")

logger = logging.getLogger(__name__)


async def _create_model_router() -> Optional[ModelRouter]:
    """Create a ModelRouter and validate Ollama connection.
    Returns None if Ollama is unreachable or model not found."""
    try:
        router = ModelRouter()
        ollama_client = router.get_model("ollama")
        if await ollama_client.validate():
            return router
        logger.warning("Ollama validation failed; proceeding without model router")
        return None
    except Exception as e:
        logger.warning("Failed to create ModelRouter: %s; proceeding without model router", e)
        return None


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check endpoint."""
    return HealthResponse(status="ok")


@app.post("/run", response_model=RunResponse)
async def run_goal(request: RunRequest) -> RunResponse:
    """Execute a goal using the orchestrator."""
    run_uuid = uuid.uuid4().hex[:8]
    workspace_root = Path('.infinity') / 'runs' / run_uuid
    workspace_root.mkdir(parents=True, exist_ok=True)
    
    db = Database()
    await db.initialize()
    model_router = await _create_model_router()
    orchestrator = Orchestrator()

    try:
        summary = await orchestrator.execute_goal(
            goal=request.goal,
            db=db,
            model_router=model_router,
            workspace_root=workspace_root,
            max_agents=request.max_agents,
            timeout=request.timeout,
            enable_sync=request.enable_sync,
            sync_base_url=request.sync_base_url,
        )

        await TaskRepository.create(
            db,
            Task(
                task_id=f"server-run-{run_uuid}",
                run_id=run_uuid,
                agent_id="server",
                status=RuntimeStatus.COMPLETED if summary.get("success") else RuntimeStatus.FAILED,
                input={"goal": request.goal},
                output=summary,
                retry_count=0,
            ),
        )
        await ExecutionLogRepository.append(
            db,
            ExecutionLog(
                run_id=run_uuid,
                agent_id="server",
                level="info" if summary.get("success") else "error",
                message=f"Run completed for goal: {request.goal}",
            ),
        )

        return RunResponse(run_id=run_uuid, **summary)
    finally:
        await db.close()


@app.post("/tools/execute", response_model=ToolExecuteResponse)
async def tools_execute(request: ToolExecuteRequest) -> ToolExecuteResponse:
    """Execute a tool by forwarding the request to the TypeScript tool bridge."""
    bridge_url = os.environ.get("INFINITY_TOOL_BRIDGE_URL", "http://127.0.0.1:8001")
    client = ToolClient(bridge_url)
    result = client.execute(request.tool, request.input)
    return ToolExecuteResponse(**result)


@app.post("/ask", response_model=AskResponse)
async def ask_question(request: AskRequest) -> AskResponse:
    """Ask a question using the configured provider."""
    settings = load_settings()
    
    # Determine provider and model from request or settings
    provider_id = request.provider
    model = request.model
    
    # Handle provider/model in model string (e.g., "openai/gpt-4o-mini")
    if model and "/" in model and not provider_id:
        provider_id, model = model.split("/", 1)
    
    # Fall back to settings defaults
    if not provider_id:
        provider_id = settings.default_provider
    if not model:
        model = settings.default_model
        # If default_model contains provider prefix matching provider_id, strip it
        if "/" in model and model.startswith(f"{provider_id}/"):
            model = model.split("/", 1)[1]
    
    # Resolve API key
    api_key = settings.api_keys.get(provider_id)
    if not api_key and provider_id not in ("ollama", "local"):
        raise HTTPException(
            status_code=400,
            detail=f"No API key configured for provider '{provider_id}'. Run 'infinity config' to add one.",
        )
    
    try:
        provider = get_provider(provider_id, api_key=api_key)
        messages = [{"role": "user", "content": request.prompt}]
        response = await provider.chat(messages, model=model)
        return AskResponse(response=response)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Provider error: %s", e)
        raise HTTPException(status_code=503, detail=f"Provider error: {e}")