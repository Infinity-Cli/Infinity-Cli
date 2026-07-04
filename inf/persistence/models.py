"""Pydantic persistence models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field


class RuntimeStatus(StrEnum):
    """Shared lifecycle statuses for persisted runtime entities."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


class AgentState(BaseModel):
    """Persisted state for an agent instance."""

    id: Optional[int] = None
    agent_id: str
    role: str
    status: RuntimeStatus = Field(default=RuntimeStatus.PENDING)
    goal: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class Task(BaseModel):
    """A unit of work in the Infinity runtime."""

    id: Optional[int] = None
    task_id: str
    run_id: str
    agent_id: str
    status: RuntimeStatus = Field(default=RuntimeStatus.PENDING)
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    retry_count: int = Field(default=0)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ExecutionLog(BaseModel):
    """Log entry for a step of execution."""

    id: Optional[int] = None
    run_id: str
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    level: str
    message: str
    timestamp: Optional[datetime] = None


class DAGNode(BaseModel):
    """A node in a persisted execution DAG."""

    id: Optional[int] = None
    run_id: Optional[str] = None
    node_id: str
    dependencies: list[str] = Field(default_factory=list)
    status: RuntimeStatus = Field(default=RuntimeStatus.PENDING)
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
