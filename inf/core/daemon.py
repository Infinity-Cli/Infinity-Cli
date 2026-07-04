"""Runtime daemon skeleton."""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class RuntimeDaemon:
    """Async runtime daemon skeleton."""

    def __init__(self) -> None:
        self._running: bool = False
        self._stop_event: Optional[asyncio.Event] = None

    @property
    def is_running(self) -> bool:
        """Return True if the daemon is currently running."""
        return self._running

    async def start(self) -> None:
        """Start the runtime daemon."""
        if self._running:
            logger.warning("Daemon is already running")
            return
        self._stop_event = asyncio.Event()
        self._running = True
        logger.info("Runtime daemon started")

    async def stop(self) -> None:
        """Stop the runtime daemon."""
        if not self._running:
            logger.warning("Daemon is not running")
            return
        if self._stop_event is not None:
            self._stop_event.set()
        self._running = False
        logger.info("Runtime daemon stopped")
