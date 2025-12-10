import json
import os
import sys
from typing import List, Dict, Any, Optional, AsyncGenerator

try:
    from .core.llm_client import LLMClient
    from .core.messages import UnifiedMessage, ToolCall, ContentPart
    from .core.base_tool import BaseTool
    from .tools import (
        ScreenCaptureTool,
        MouseControlTool,
        KeyboardControlTool,
        ExecuteShellTool,
        ReadFileTool,
        WriteFileTool,
        EditFileTool,
        ListFilesTool,
        CreateFolderTool,
        DeleteFileTool,
        RenameFileTool,
        SearchInFilesTool,
        ProjectStructureTool,
        ProjectStructureAliasTool,
    )
    from . import database
except ImportError:
    # Fallback for running as a top-level module (e.g., `uvicorn main:app` from backend/)
    if __package__:
        raise
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from core.llm_client import LLMClient
    from core.messages import UnifiedMessage, ToolCall, ContentPart
    from core.base_tool import BaseTool
    from tools import (
        ScreenCaptureTool,
        MouseControlTool,
        KeyboardControlTool,
        ExecuteShellTool,
        ReadFileTool,
        WriteFileTool,
        EditFileTool,
        ListFilesTool,
        CreateFolderTool,
        DeleteFileTool,
        RenameFileTool,
        SearchInFilesTool,
        ProjectStructureTool,
        ProjectStructureAliasTool,
    )
    import database

TOOL_GUIDANCE = (
    "You have full read/write access to the project's real file system. You may create, modify, "
    "or delete any files as needed using the tools (read_file, write_file, list_files, create_folder, "
    "delete_file, rename_file, search_in_files, get_project_structure, get_current_project_structure). "
    "Always persist code changes to disk so the user can run and preview them."
)

MODE_PROMPTS: Dict[str, str] = {
    "chat": (
        "You are in Chat mode. Provide concise, helpful answers without invoking tools. "
        "Keep responses focused on the user message."
    ),
    "plan": (
        "You are in Plan mode. Always return structured project plans, roadmaps, Gantt-ready "
        "milestones, or TODO lists. Prefer Markdown lists and tables. Keep outputs well-structured "
        "and immediately actionable."
    ),
    "canva": (
        "You are in Canva mode. Focus on building and updating frontend or full-stack artifacts "
        "(HTML/CSS/JS/React). 你拥有完整的文件系统读写权限，可以随意创建、修改、删除项目中的任意文件。 "
        "Use the workspace tools to read and write real files so the preview updates live. If you need "
        "assets or folders, create them explicitly. "
        f"{TOOL_GUIDANCE}"
    ),
    "agent": (
        "You are in Agent mode with all tools enabled. You may take multi-step actions, use tools "
        "freely, and keep the user informed. 你拥有完整的文件系统读写权限，可以随意创建、修改、删除项目中的任意文件。 "
        "Favor using the workspace file tools and shell to make real changes that the user can run. "
        + TOOL_GUIDANCE
    ),
}


class Agent:
    def __init__(self, llm: LLMClient, session_id: str = None):
        self.llm = llm
        self.session_id = session_id
        self.history: List[UnifiedMessage] = []
        self.mode: str = "chat"
        self.tools: List[BaseTool] = []
        self.system_prompt: Optional[str] = MODE_PROMPTS.get("chat")
        self.tool_overrides: Optional[List[str]] = None
        self._init_tools()
        if session_id:
            self._load_history()

    def _init_tools(self):
        # Initialize all tools
        self.screen_tool = ScreenCaptureTool()
        self.file_tools: List[BaseTool] = [
            ReadFileTool(),
            WriteFileTool(),
            EditFileTool(),
            ListFilesTool(),
            CreateFolderTool(),
            DeleteFileTool(),
            RenameFileTool(),
            SearchInFilesTool(),
            ProjectStructureTool(),
            ProjectStructureAliasTool(),
        ]
        self.shell_tool = ExecuteShellTool()
        self.control_tools: List[BaseTool] = [
            self.screen_tool,
            MouseControlTool(),
            KeyboardControlTool(),
        ]
        self.canva_toolset: List[BaseTool] = self.file_tools + [self.shell_tool]
        self.agent_toolset: List[BaseTool] = self.canva_toolset + self.control_tools
        self.tools = []

    def _apply_tool_policy(self, override_names: Optional[List[str]] = None):
        """
        Populate self.tools according to current mode and optional per-mode whitelist.
        - If override_names is falsy (None or []), keep the full default toolset for the mode.
        - If override_names is a non-empty list, only keep the listed tools.
        """
        base: List[BaseTool] = []
        if self.mode == "agent":
            base = list(self.agent_toolset)
        elif self.mode == "canva":
            base = list(self.canva_toolset)
        # Chat/plan intentionally keep tools empty
        if override_names:
            allowed = set(override_names)
            base = [tool for tool in base if tool.name in allowed]
        self.tools = base
        self.tool_overrides = override_names

    def set_mode(self, mode: str):
        if mode not in ["chat", "plan", "canva", "agent"]:
            raise ValueError("Invalid mode. Must be one of chat/plan/canva/agent")
        self.mode = mode
        self.system_prompt = MODE_PROMPTS.get(mode)
        self._apply_tool_policy(self.tool_overrides)
        self._ensure_system_prompt()

    def _ensure_system_prompt(self):
        """Make sure the history always starts with the active mode prompt."""
        if not self.system_prompt:
            return
        existing_system = next((m for m in self.history if m.role == "system"), None)
        if existing_system:
            existing_system.content = self.system_prompt
        else:
            self.history.insert(0, UnifiedMessage(role="system", content=self.system_prompt))

    def _save_message(self, message: UnifiedMessage, metadata: Optional[Dict[str, Any]] = None):
        if not self.session_id:
            return

        # Persist mode together with the raw message payload for auditability
        payload: Any
        if isinstance(message.content, str) and not message.tool_calls and not message.tool_call_id:
            payload = {
                "mode": self.mode,
                "message": {
                    "role": message.role,
                    "content": message.content
                },
                "meta": metadata
            }
        else:
            payload = {
                "mode": self.mode,
                "message": message.model_dump(exclude_none=True),
                "meta": metadata
            }
        database.add_message(self.session_id, message.role, payload)

    def _load_history(self):
        if not self.session_id:
            return
            
        db_messages = database.get_messages(self.session_id)
        self.history = []
        
        for db_msg in db_messages:
            role = db_msg['role']
            raw_content = db_msg['content']
            payload = raw_content

            if isinstance(raw_content, dict) and "message" in raw_content:
                payload = raw_content.get("message", {})

            if isinstance(payload, dict):
                message_payload = dict(payload)
                message_payload.setdefault("role", role)
                if isinstance(message_payload.get("content"), list):
                    message_payload["content"] = [
                        ContentPart(**p) if not isinstance(p, ContentPart) else p 
                        for p in message_payload["content"]
                    ]
                self.history.append(UnifiedMessage(**message_payload))
            elif isinstance(payload, list):
                 parts = [ContentPart(**p) for p in payload]
                 self.history.append(UnifiedMessage(role=role, content=parts))
            else:
                self.history.append(UnifiedMessage(role=role, content=payload))

        self._ensure_system_prompt()

    async def _execute_tool(self, tool_call: ToolCall) -> str:
        tool_name = tool_call.function["name"]
        tool_args = tool_call.function["arguments"]
        
        # Find the tool instance
        tool = next((t for t in self.tools if t.name == tool_name), None)
        
        if not tool:
            return f"Error: Tool '{tool_name}' not found."
        
        try:
            result = await tool.execute(**tool_args)
            return json.dumps(result)
        except Exception as e:
            return f"Error executing tool '{tool_name}': {str(e)}"

    async def chat(
        self, 
        user_input: str, 
        attachments: Optional[List[Dict[str, Any]]] = None,
        mode: Optional[str] = None,
        tool_overrides: Optional[List[str]] = None
    ) -> AsyncGenerator[str, None]:
        if mode:
            self.set_mode(mode)
        else:
            self._ensure_system_prompt()
        if tool_overrides is not None:
            self._apply_tool_policy(tool_overrides)

        # Add user message
        content_parts: List[ContentPart] = []
        if user_input:
            content_parts.append(ContentPart(type="text", text=user_input))

        # Attach images/files
        normalized_attachments: List[Dict[str, Any]] = []
        for att in attachments or []:
            if hasattr(att, "model_dump"):
                normalized_attachments.append(att.model_dump())
            else:
                normalized_attachments.append(att)

        for attachment in normalized_attachments:
            att_type = attachment.get("type")
            data = attachment.get("data")
            name = attachment.get("name") or "attachment"
            mime = attachment.get("mime_type") or ""
            if att_type == "image" and data:
                content_parts.append(ContentPart(type="image_url", image_url={"url": data}))
            else:
                # Non-image attachments are summarized as text for the model
                summary = f"[file] {name} ({mime}) attached."
                content_parts.append(ContentPart(type="text", text=summary))

        # If in agent/canva mode, add screenshot automatically for more context
        if self.mode == "agent" and any(t.name == "screen_capture" for t in self.tools):
            try:
                screenshot = await self.screen_tool.execute()
                content_parts.append(ContentPart(type="image_url", image_url={"url": screenshot["data"]}))
            except Exception as e:
                yield f"Error capturing screenshot: {str(e)}"
                return

        user_msg = UnifiedMessage(role="user", content=content_parts if content_parts else user_input)
        self.history.append(user_msg)
        self._save_message(user_msg, {"attachments": normalized_attachments} if normalized_attachments else None)
        
        # Loop for tool execution
        while True:
            try:
                response_msg = await self.llm.chat_completion(
                    messages=self.history,
                    tools=self.tools,
                    session_id=self.session_id
                )
            except Exception as e:
                yield f"Error calling LLM: {str(e)}"
                return
            
            self.history.append(response_msg)
            self._save_message(response_msg)
            
            if response_msg.content:
                yield response_msg.content

            if not response_msg.tool_calls:
                break
                
            # Execute tools
            for tool_call in response_msg.tool_calls:
                # Notify UI about tool execution
                yield f"\n[Executing {tool_call.function['name']}...]\n"
                
                result = await self._execute_tool(tool_call)
                
                tool_msg = UnifiedMessage(
                    role="tool",
                    tool_call_id=tool_call.id,
                    content=result,
                    name=tool_call.function["name"]
                )
                self.history.append(tool_msg)
                self._save_message(tool_msg)
            
            # Refresh screenshot in active tool modes
            if self.mode == "agent" and any(t.name == "screen_capture" for t in self.tools):
                try:
                    screenshot = await self.screen_tool.execute()
                    screenshot_msg = UnifiedMessage(
                        role="user", 
                        content=[
                            ContentPart(type="text", text="(Screenshot after tool execution)"),
                            ContentPart(type="image_url", image_url={"url": screenshot["data"]})
                        ]
                    )
                    self.history.append(screenshot_msg)
                    self._save_message(screenshot_msg)
                except Exception as e:
                    yield f"Error capturing screenshot (after tool): {str(e)}"
                    pass

    def clear_history(self):
        self.history = []
        # Note: clear_history in DB context might mean deleting messages? 
        # But usually we just create a new session. 
        # For legacy compatibility, if session_id is set, we might not want to wipe DB unless explicit.
        # But handleClear in frontend calls /api/clear.
        if self.session_id:
            # Maybe implement a delete_messages logic in database if needed, 
            # or just rely on session deletion.
            pass

    async def check_health(self, model: Optional[str] = None) -> bool:
        return await self.llm.check_health(model=model)
