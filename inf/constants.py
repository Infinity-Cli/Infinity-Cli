"""Constants for Infinity CLI"""

from enum import Enum


class AgentStatus(str, Enum):
    """Agent execution status"""
    PLANNING = "planning"
    EXECUTING = "executing"
    REPAIRING = "repairing"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING = "waiting"
    PAUSED = "paused"