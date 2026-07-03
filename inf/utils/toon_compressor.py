"""Toon Token Optimization & Context Compression Engine.

Toon-style formatting compresses prompt representations, reduces context-window usage,
collapses verbose JSON schema structures, and minimizes long execution logs or histories.
"""

import json
from typing import Any, Dict, List, Union


class ToonCompressor:
    """Toon token optimization and payload compaction utility."""

    @staticmethod
    def compress_history(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Compress conversational/execution history payloads to optimize context window."""
        compressed = []
        for turn in history:
            role = turn.get("role", "system")
            content = turn.get("content", "")
            if isinstance(content, str):
                # Apply token saving rules: remove excessive whitespace, strip empty lines
                lines = [line.strip() for line in content.splitlines() if line.strip()]
                compact_content = "\n".join(lines)
                # Abbreviate long repetitive stack traces
                if "Traceback" in compact_content:
                    compact_content = ToonCompressor.compress_traceback(compact_content)
                compressed.append({"role": role, "content": compact_content})
            else:
                compressed.append(turn)
        return compressed

    @staticmethod
    def compress_traceback(traceback_str: str) -> str:
        """Truncate and contract redundant python traceback frames to preserve top/bottom frames."""
        lines = traceback_str.splitlines()
        if len(lines) <= 12:
            return traceback_str
        
        # Keep first 4 and last 6 lines of traceback
        compressed = lines[:4] + ["[... Toon: Compressed trace frames ...]"] + lines[-6:]
        return "\n".join(compressed)

    @staticmethod
    def compress_schema(schema: Dict[str, Any]) -> str:
        """Minify structural OpenAPI / JSON Schema metadata into a compressed notation.

        Turns a verbose nested dictionary schema into a single-line or tightly packed string format.
        """
        # Compact formatting, removing spaces in keys and structure
        return json.dumps(schema, separators=(",", ":"))

    @staticmethod
    def compress_prompt(prompt: str) -> str:
        """Optimize prompt template text by replacing verbose phrases with token-efficient instructions."""
        # Replace verbose instructions with high-density equivalents
        replacements = {
            "Please write the code carefully.": "Write optimized code.",
            "Make sure to handle exceptions and errors properly.": "Handle exceptions.",
            "Do not output anything other than the raw code.": "Raw code only.",
            "For your information, the current workspace state is": "State:",
            "  ": " ", # collapse double spaces
        }
        compressed = prompt
        for verbose, compact in replacements.items():
            compressed = compressed.replace(verbose, compact)
        return compressed.strip()
