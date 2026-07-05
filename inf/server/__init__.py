"""Infinity CLI server package."""

from inf.server.app import app
from inf.server.server import start_server

__all__ = ["app", "start_server"]