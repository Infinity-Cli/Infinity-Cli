import pytest
from pathlib import Path
from inf.utils.toon_compressor import ToonCompressor
from inf.utils.skylos_sandbox import SkylosSandbox, SkylosSandboxError
from inf.utils.multica_collaboration import MulticaCollaborationEngine, MulticaMessage


def test_toon_compressor_history():
    history = [
        {"role": "user", "content": "  hello  \n\n   world  "},
        {"role": "assistant", "content": "This is a traceback:\nTraceback (most recent call last):\n  File \"base.py\", line 10\n  File \"run.py\", line 20\n  File \"other.py\", line 30\n  File \"foo.py\", line 40\n  File \"bar.py\", line 50\n  File \"baz.py\", line 60\n  File \"qux.py\", line 70\n  File \"zip.py\", line 80\n  File \"zap.py\", line 90\n  File \"zop.py\", line 100\nValueError: Error"}
    ]
    compressed = ToonCompressor.compress_history(history)
    assert compressed[0]["content"] == "hello\nworld"
    assert "[... Toon: Compressed trace frames ...]" in compressed[1]["content"]


def test_toon_compressor_schema():
    schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    compressed_schema = ToonCompressor.compress_schema(schema)
    assert " " not in compressed_schema


def test_skylos_sandbox_path_validation():
    sandbox_dir = Path("C:/Users/satya/workspace/test_sandbox")
    sandbox = SkylosSandbox(allowed_workspace=sandbox_dir)
    
    # Valid path
    valid_path = sandbox_dir / "src/App.tsx"
    assert sandbox.validate_path(valid_path) == valid_path.resolve()
    
    # Invalid path
    invalid_path = Path("C:/Users/satya/Documents")
    with pytest.raises(SkylosSandboxError):
        sandbox.validate_path(invalid_path)


def test_skylos_sandbox_command_validation():
    sandbox = SkylosSandbox(allowed_workspace=Path("C:/Users/satya/workspace/test_sandbox"))
    
    # Safe command
    assert sandbox.validate_command("echo hello") == "echo hello"
    
    # Banned patterns
    with pytest.raises(SkylosSandboxError):
        sandbox.validate_command("rm -rf /home/user")
        
    with pytest.raises(SkylosSandboxError):
        sandbox.validate_command("powershell.exe -Command Write-Host")


@pytest.mark.asyncio
async def test_multica_collaboration():
    engine = MulticaCollaborationEngine()
    engine.register_agent("agent_1")
    engine.register_agent("agent_2")
    
    msg = MulticaMessage(
        sender_id="agent_1",
        receiver_type="agent_2",
        message_type="task_completed",
        payload={"result": "success"}
    )
    
    await engine.send_message(msg)
    
    messages = await engine.fetch_messages("agent_2")
    assert len(messages) == 1
    assert messages[0].sender_id == "agent_1"
    assert messages[0].payload["result"] == "success"
