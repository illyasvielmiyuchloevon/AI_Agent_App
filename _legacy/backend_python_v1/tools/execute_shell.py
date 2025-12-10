import asyncio
import os
import subprocess
import sys
from typing import Dict, Any, Optional

try:
    from ..core.base_tool import BaseTool
    from .. import filesystem
except ImportError:
    if __package__ and __package__.startswith("backend"):
        raise
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from core.base_tool import BaseTool
    import filesystem


class ExecuteShellTool(BaseTool):
    name = "execute_shell"
    description = "Execute a shell command and return the output."
    input_schema = {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The command to execute."
            },
            "workdir": {
                "type": "string",
                "description": "Optional working directory relative to the workspace root."
            }
        },
        "required": ["command"]
    }

    def _resolve_workdir(self, workdir: Optional[str]) -> str:
        """
        Resolve the working directory to an absolute path inside the workspace root.
        """
        if workdir is None or workdir == "":
            return filesystem.get_workspace_root()
        # Re-use the filesystem path resolver to enforce workspace sandboxing.
        return filesystem._resolve_path(workdir)  # type: ignore[attr-defined]

    async def execute(self, command: str, workdir: Optional[str] = None) -> Dict[str, Any]:
        try:
            cwd = self._resolve_workdir(workdir)
            # Use asyncio.create_subprocess_shell for non-blocking execution
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd
            )
            
            stdout, stderr = await process.communicate()
            stdout_text = stdout.decode(errors="replace").strip()
            stderr_text = stderr.decode(errors="replace").strip()
            status = "success" if process.returncode == 0 else "error"
            message = (
                "Command completed"
                if status == "success"
                else (stderr_text or f"Command exited with code {process.returncode}")
            )

            return {
                "status": status,
                "message": message,
                "return_code": process.returncode,
                "stdout": stdout_text,
                "stderr": stderr_text,
                "cwd": cwd,
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }
