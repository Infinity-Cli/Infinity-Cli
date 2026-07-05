"""Server startup module for Infinity CLI."""

import uvicorn


def start_server(host: str = "127.0.0.1", port: int = 8000) -> None:
    """Start the FastAPI server using uvicorn.

    Args:
        host: Host address to bind to.
        port: Port number to listen on.
    """
    uvicorn.run("inf.server.app:app", host=host, port=port, reload=False)