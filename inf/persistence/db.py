"""Async SQLite persistence layer using aiosqlite."""

import importlib.resources as pkg_resources
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiosqlite

logger = logging.getLogger(__name__)


class Database:
    """Manages an async SQLite connection and schema migrations."""

    def __init__(self, database_url: Optional[str] = None) -> None:
        self.database_url = database_url or "sqlite+aiosqlite:///infinity.db"
        self.connection: Optional[aiosqlite.Connection] = None

    def _path_from_url(self) -> Path:
        """Extract filesystem path from an aiosqlite database URL."""
        prefix = "sqlite+aiosqlite:///"
        if self.database_url.startswith(prefix):
            return Path(self.database_url[len(prefix) :])
        if self.database_url.startswith("sqlite:///"):
            return Path(self.database_url[len("sqlite:///") :])
        return Path(self.database_url)

    async def initialize(self) -> None:
        """Initialize connection, enable WAL, and run migrations."""
        db_path = self._path_from_url()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = await aiosqlite.connect(str(db_path))
        await self.connection.execute("PRAGMA journal_mode=WAL;")
        await self.connection.commit()
        await self._run_migrations()
        logger.info("Database initialized at %s", db_path)

    async def _run_migrations(self) -> None:
        """Run SQL migration files in order and track applied versions."""
        if self.connection is None:
            raise RuntimeError("Database connection is not initialized")
        migrations_dir = pkg_resources.files("inf.persistence") / "migrations"
        migration_files = sorted(
            migrations_dir.iterdir(), key=lambda p: p.name
        )
        for migration_file in migration_files:
            if Path(str(migration_file)).suffix.lower() == ".sql":
                sql = migration_file.read_text(encoding="utf-8")
                await self.connection.executescript(sql)
                await self.connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?);",
                    (
                        migration_file.name,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                await self.connection.commit()
                logger.info("Applied migration: %s", migration_file.name)

    async def close(self) -> None:
        """Close the database connection."""
        if self.connection is not None:
            await self.connection.close()
            self.connection = None

    async def execute(self, sql: str, parameters: Optional[tuple] = None) -> aiosqlite.Cursor:
        """Execute a SQL statement on the managed connection."""
        if self.connection is None:
            raise RuntimeError("Database connection is not initialized")
        return await self.connection.execute(sql, parameters or ())

    async def fetchall(
        self, sql: str, parameters: Optional[tuple] = None
    ) -> list[Any]:
        """Execute a query and return all rows."""
        cursor = await self.execute(sql, parameters or ())
        return list(await cursor.fetchall())

    async def fetchone(
        self, sql: str, parameters: Optional[tuple] = None
    ) -> Optional[Any]:
        """Execute a query and return the first row, if any."""
        cursor = await self.execute(sql, parameters or ())
        return await cursor.fetchone()

    async def commit(self) -> None:
        """Commit the current transaction."""
        if self.connection is None:
            raise RuntimeError("Database connection is not initialized")
        await self.connection.commit()
