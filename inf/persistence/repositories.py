"""Repository layer for Infinity-Cli persistence."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from inf.persistence.db import Database
from inf.persistence.models import (
    AgentState,
    DAGNode,
    ExecutionLog,
    RuntimeStatus,
    Task,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgentRepository:
    """Persistence operations for agent_states."""

    @staticmethod
    async def create_or_update(db: Database, agent: AgentState) -> AgentState:
        payload_json = json.dumps(agent.payload or {})
        now = _now()
        await db.execute(
            """
            INSERT INTO agent_states (agent_id, role, status, goal, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(agent_id) DO UPDATE SET
                role = excluded.role,
                status = excluded.status,
                goal = excluded.goal,
                payload = excluded.payload,
                updated_at = excluded.updated_at;
            """,
            (
                agent.agent_id,
                agent.role,
                agent.status.value,
                agent.goal,
                payload_json,
                agent.created_at or now,
                now,
            ),
        )
        await db.commit()
        result = await AgentRepository.get(db, agent.agent_id)
        if result is None:
            raise RuntimeError(f"Failed to retrieve agent after create_or_update: {agent.agent_id}")
        return result

    @staticmethod
    async def get(db: Database, agent_id: str) -> Optional[AgentState]:
        row = await db.fetchone(
            "SELECT id, agent_id, role, status, goal, payload, created_at, updated_at "
            "FROM agent_states WHERE agent_id = ?;",
            (agent_id,),
        )
        if row is None:
            return None
        return AgentState(
            id=row[0],
            agent_id=row[1],
            role=row[2],
            status=RuntimeStatus(row[3]),
            goal=row[4],
            payload=json.loads(row[5]) if row[5] else {},
            created_at=row[6],
            updated_at=row[7],
        )

    @staticmethod
    async def list(db: Database) -> list[AgentState]:
        rows = await db.fetchall(
            "SELECT id, agent_id, role, status, goal, payload, created_at, updated_at "
            "FROM agent_states ORDER BY updated_at DESC;"
        )
        return [
            AgentState(
                id=row[0],
                agent_id=row[1],
                role=row[2],
                status=RuntimeStatus(row[3]),
                goal=row[4],
                payload=json.loads(row[5]) if row[5] else {},
                created_at=row[6],
                updated_at=row[7],
            )
            for row in rows
        ]

    @staticmethod
    async def delete(db: Database, agent_id: str) -> bool:
        cursor = await db.execute(
            "DELETE FROM agent_states WHERE agent_id = ?;", (agent_id,)
        )
        await db.commit()
        return cursor.rowcount > 0


class TaskRepository:
    """Persistence operations for tasks."""

    @staticmethod
    async def create(db: Database, task: Task) -> Task:
        now = _now()
        cursor = await db.execute(
            """
            INSERT INTO tasks (task_id, run_id, agent_id, status, input, output, retry_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                task.task_id,
                task.run_id,
                task.agent_id,
                task.status.value,
                json.dumps(task.input or {}),
                json.dumps(task.output or {}),
                task.retry_count,
                task.created_at or now,
                now,
            ),
        )
        await db.commit()
        task.id = cursor.lastrowid
        return task

    @staticmethod
    async def update_status(
        db: Database,
        run_id: str,
        task_id: str,
        status: RuntimeStatus,
        output: Optional[dict] = None,
        retry_count: Optional[int] = None,
    ) -> bool:
        completed_at = None
        if status == RuntimeStatus.COMPLETED:
            completed_at = _now()
        cursor = await db.execute(
            """
            UPDATE tasks
            SET status = ?,
                output = COALESCE(?, output),
                retry_count = COALESCE(?, retry_count),
                updated_at = ?,
                completed_at = COALESCE(?, completed_at)
            WHERE run_id = ? AND task_id = ?;
            """,
            (
                status.value,
                json.dumps(output) if output is not None else None,
                retry_count,
                _now(),
                completed_at,
                run_id,
                task_id,
            ),
        )
        await db.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def get(db: Database, run_id: str, task_id: str) -> Optional[Task]:
        row = await db.fetchone(
            "SELECT id, task_id, run_id, agent_id, status, input, output, retry_count, "
            "created_at, updated_at, completed_at FROM tasks WHERE run_id = ? AND task_id = ?;",
            (run_id, task_id),
        )
        if row is None:
            return None
        return Task(
            id=row[0],
            task_id=row[1],
            run_id=row[2],
            agent_id=row[3],
            status=RuntimeStatus(row[4]),
            input=json.loads(row[5]) if row[5] else {},
            output=json.loads(row[6]) if row[6] else {},
            retry_count=row[7],
            created_at=row[8],
            updated_at=row[9],
            completed_at=row[10],
        )

    @staticmethod
    async def list_by_agent(db: Database, agent_id: str) -> list[Task]:
        rows = await db.fetchall(
            "SELECT id, task_id, run_id, agent_id, status, input, output, retry_count, "
            "created_at, updated_at, completed_at FROM tasks WHERE agent_id = ? ORDER BY created_at DESC;",
            (agent_id,),
        )
        return [
            Task(
                id=row[0],
                task_id=row[1],
                run_id=row[2],
                agent_id=row[3],
                status=RuntimeStatus(row[4]),
                input=json.loads(row[5]) if row[5] else {},
                output=json.loads(row[6]) if row[6] else {},
                retry_count=row[7],
                created_at=row[8],
                updated_at=row[9],
                completed_at=row[10],
            )
            for row in rows
        ]

    @staticmethod
    async def list_by_run(db: Database, run_id: str) -> list[Task]:
        rows = await db.fetchall(
            "SELECT id, task_id, run_id, agent_id, status, input, output, retry_count, "
            "created_at, updated_at, completed_at FROM tasks WHERE run_id = ? ORDER BY created_at DESC;",
            (run_id,),
        )
        return [
            Task(
                id=row[0],
                task_id=row[1],
                run_id=row[2],
                agent_id=row[3],
                status=RuntimeStatus(row[4]),
                input=json.loads(row[5]) if row[5] else {},
                output=json.loads(row[6]) if row[6] else {},
                retry_count=row[7],
                created_at=row[8],
                updated_at=row[9],
                completed_at=row[10],
            )
            for row in rows
        ]


class ExecutionLogRepository:
    """Persistence operations for execution_logs."""

    @staticmethod
    async def append(db: Database, log: ExecutionLog) -> ExecutionLog:
        cursor = await db.execute(
            """
            INSERT INTO execution_logs (run_id, agent_id, task_id, level, message, timestamp)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (
                log.run_id,
                log.agent_id,
                log.task_id,
                log.level,
                log.message,
                log.timestamp or _now(),
            ),
        )
        await db.commit()
        log.id = cursor.lastrowid
        return log

    @staticmethod
    async def list_by_run(db: Database, run_id: str) -> list[ExecutionLog]:
        rows = await db.fetchall(
            "SELECT id, run_id, agent_id, task_id, level, message, timestamp "
            "FROM execution_logs WHERE run_id = ? ORDER BY timestamp ASC;",
            (run_id,),
        )
        return [
            ExecutionLog(
                id=row[0],
                run_id=row[1],
                agent_id=row[2],
                task_id=row[3],
                level=row[4],
                message=row[5],
                timestamp=row[6],
            )
            for row in rows
        ]

    @staticmethod
    async def list_by_agent(db: Database, agent_id: str) -> list[ExecutionLog]:
        rows = await db.fetchall(
            "SELECT id, run_id, agent_id, task_id, level, message, timestamp "
            "FROM execution_logs WHERE agent_id = ? ORDER BY timestamp ASC;",
            (agent_id,),
        )
        return [
            ExecutionLog(
                id=row[0],
                run_id=row[1],
                agent_id=row[2],
                task_id=row[3],
                level=row[4],
                message=row[5],
                timestamp=row[6],
            )
            for row in rows
        ]


class DAGNodeRepository:
    """Persistence operations for dag_nodes."""

    @staticmethod
    async def create_nodes_for_run(db: Database, run_id: str, nodes: list[DAGNode]) -> list[DAGNode]:
        now = _now()
        for node in nodes:
            await db.execute(
                """
                INSERT INTO dag_nodes (run_id, node_id, dependencies, status, payload, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, node_id) DO UPDATE SET
                    dependencies = excluded.dependencies,
                    status = excluded.status,
                    payload = excluded.payload,
                    updated_at = excluded.updated_at;
                """,
                (
                    run_id,
                    node.node_id,
                    json.dumps(node.dependencies or []),
                    node.status.value,
                    json.dumps(node.payload or {}),
                    node.created_at or now,
                    now,
                ),
            )
        await db.commit()
        return await DAGNodeRepository.list_by_run(db, run_id)

    @staticmethod
    async def list_by_run(db: Database, run_id: str) -> list[DAGNode]:
        rows = await db.fetchall(
            "SELECT id, run_id, node_id, dependencies, status, payload, created_at, updated_at "
            "FROM dag_nodes WHERE run_id = ? ORDER BY created_at ASC;",
            (run_id,),
        )
        return [
            DAGNode(
                id=row[0],
                run_id=row[1],
                node_id=row[2],
                dependencies=json.loads(row[3]) if row[3] else [],
                status=RuntimeStatus(row[4]),
                payload=json.loads(row[5]) if row[5] else {},
                created_at=row[6],
                updated_at=row[7],
            )
            for row in rows
        ]

    @staticmethod
    async def get_execution_order(db: Database, run_id: str) -> list[str]:
        rows = await db.fetchall(
            "SELECT node_id, dependencies FROM dag_nodes WHERE run_id = ?;",
            (run_id,),
        )
        nodes = {row[0]: set(json.loads(row[1]) if row[1] else []) for row in rows}

        order: list[str] = []
        remaining = dict(nodes)
        while remaining:
            ready = [nid for nid, deps in remaining.items() if not deps]
            if not ready:
                raise ValueError(f"Cycle detected in DAG for run {run_id}")
            ready.sort()
            for nid in ready:
                order.append(nid)
                del remaining[nid]
                for deps in remaining.values():
                    deps.discard(nid)
        return order

    @staticmethod
    async def update_status(
        db: Database, run_id: str, node_id: str, status: RuntimeStatus
    ) -> bool:
        cursor = await db.execute(
            "UPDATE dag_nodes SET status = ?, updated_at = ? WHERE run_id = ? AND node_id = ?;",
            (status.value, _now(), run_id, node_id),
        )
        await db.commit()
        return cursor.rowcount > 0
