"""Client that forwards tool execution requests to the TypeScript tool bridge."""

import json
import urllib.error
import urllib.request


class ToolClient:
    """Forward tool execution calls to the TS CLI tool bridge."""

    def __init__(self, base_url: str = "http://127.0.0.1:8001") -> None:
        self.base_url = base_url.rstrip("/")

    def execute(self, tool: str, input_data: dict) -> dict:
        """Send a tool execution request to the TS bridge and return the result."""
        url = f"{self.base_url}/execute"
        payload = json.dumps({"tool": tool, "input": input_data}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Content-Length": str(len(payload)),
        }
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            return {"success": False, "error": f"Tool bridge HTTP {e.code}: {body}"}
        except urllib.error.URLError as e:
            return {"success": False, "error": f"Tool bridge unreachable: {e.reason}"}
        except Exception as e:  # pragma: no cover - safety net
            return {"success": False, "error": f"Tool bridge error: {e}"}
