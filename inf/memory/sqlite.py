"""SQLite-based persistence for agent states and execution logs"""

from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime
import aiosqlite
import json

DB_PATH = Path("workspace") / ".infinity" / "memory.db"


class MemoryDB:
    """SQLite persistence for execution state"""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_PATH
        self._initialized = False

    async def init(self):
        """Initialize database schema"""
        if self._initialized:
            return

        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    task_id TEXT,
                    workspace TEXT,
                    status TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    result TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT,
                    goal TEXT,
                    priority INTEGER,
                    status TEXT,
                    retries INTEGER DEFAULT 0,
                    created_at TEXT,
                    completed_at TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id TEXT,
                    level TEXT,
                    message TEXT,
                    timestamp TEXT
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS executions (
                    id TEXT PRIMARY KEY,
                    goal TEXT,
                    status TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    archive_path TEXT
                )
            """)
            await db.commit()

        self._initialized = True

    async def save_agent(self, agent_id: str, data: Dict[str, Any]):
        """Save agent state to database"""
        await self.init()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT OR REPLACE INTO agents (id, task_id, workspace, status, created_at, updated_at, result)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                agent_id,
                data.get("task_id"),
                data.get("workspace"),
                data.get("status"),
                data.get("created_at", datetime.now().isoformat()),
                datetime.now().isoformat(),
                json.dumps(data.get("result", {}))
            ))
            await db.commit()

    async def get_agent(self, agent_id: str) -> Optional[Dict]:
        """Retrieve agent state"""
        await self.init()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def save_log(self, agent_id: str, level: str, message: str):
        """Save execution log entry"""
        await self.init()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO logs (agent_id, level, message, timestamp)
                VALUES (?, ?, ?, ?)
            """, (agent_id, level, message, datetime.now().isoformat()))
            await db.commit()

    async def create_execution(self, execution_id: str, goal: str):
        """Create new execution record"""
        await self.init()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT INTO executions (id, goal, status, started_at)
                VALUES (?, ?, ?, ?)
            """, (execution_id, goal, "running", datetime.now().isoformat()))
            await db.commit()

    async def complete_execution(self, execution_id: str, status: str = "completed"):
        """Mark execution as complete"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                UPDATE executions SET status = ?, completed_at = ?
                WHERE id = ?
            """, (status, datetime.now().isoformat(), execution_id))
            await db.commit()