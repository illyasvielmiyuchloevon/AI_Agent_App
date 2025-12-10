import os
import sys

import uvicorn
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel
from typing import Optional, List, Any, Dict

try:
    # Normal package import path (when launched as `uvicorn backend.main:app`)
    from .core.providers.openai_provider import OpenAIProvider
    from .core.providers.anthropic_provider import AnthropicProvider
    from .core.llm_client import LLMClient
    from .agent import Agent
    from . import filesystem
    from . import database
except ImportError:
    # Fallback for running from within backend/ via `uvicorn main:app`
    if __package__:
        raise
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from core.providers.openai_provider import OpenAIProvider
    from core.providers.anthropic_provider import AnthropicProvider
    from core.llm_client import LLMClient
    from agent import Agent
    import filesystem
    import database

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_workspace_bound() -> str:
    """Ensure a workspace root is set for the current request and project data is initialized."""
    try:
        root = filesystem.get_workspace_root()
        database.init_db()
        _maybe_load_persisted_llm_config()
        return root
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.middleware("http")
async def inject_workspace_root(request: Request, call_next):
    """
    Allow clients to bind a project per-request via header.
    Header names: X-Workspace-Root or X-Project-Root.
    """
    header_root = request.headers.get("x-workspace-root") or request.headers.get("x-project-root")
    applied = False
    if header_root and request.url.path != "/workspace/bind-root":
        try:
            filesystem.set_request_workspace_root(header_root)
            applied = True
        except filesystem.WorkspaceError as e:
            return JSONResponse(status_code=400, content={"detail": str(e)})
    response = await call_next(request)
    if applied and isinstance(response, StreamingResponse):
        response.background = BackgroundTask(filesystem.clear_request_workspace_root)
    elif applied:
        filesystem.clear_request_workspace_root()
    return response

# Global LLM Client instance
llm_client: Optional[LLMClient] = None
llm_config: Optional[Dict[str, Any]] = None


def _build_llm_client(config: Dict[str, Any]) -> LLMClient:
    provider = config.get("provider")
    if provider == "openai":
        return OpenAIProvider(
            api_key=config.get("api_key"),
            model=config.get("model") or "gpt-4-turbo",
            base_url=config.get("base_url"),
        )
    if provider == "anthropic":
        return AnthropicProvider(
            api_key=config.get("api_key"),
            model=config.get("model") or "claude-3-opus-20240229",
            base_url=config.get("base_url"),
        )
    raise HTTPException(status_code=400, detail="Invalid provider")


def _persist_llm_config(config: Dict[str, Any]):
    database.save_llm_config(config)


def _apply_llm_config(config: Dict[str, Any]) -> Dict[str, Any]:
    global llm_client, llm_config
    llm_client = _build_llm_client(config)
    llm_config = config
    _persist_llm_config(config)
    return config


def _maybe_load_persisted_llm_config():
    """
    On first use, hydrate the in-memory llm_client/llm_config from the persisted file.
    """
    global llm_client, llm_config
    if llm_client and llm_config:
        return llm_config
    try:
        stored = database.load_llm_config()
    except Exception:
        return None
    if not stored:
        return None
    try:
        llm_client = _build_llm_client(stored)
        llm_config = stored
    except Exception:
        # Keep stored config available for the UI even if the client fails to initialize
        llm_client = None
        llm_config = stored
    return llm_config

class ConfigRequest(BaseModel):
    provider: str  # "openai" or "anthropic"
    api_key: str
    model: Optional[str] = None
    base_url: Optional[str] = None
    check_model: Optional[str] = None

class AttachmentPayload(BaseModel):
    type: str  # image | file
    name: Optional[str] = None
    mime_type: Optional[str] = None
    data: Optional[str] = None  # data URL or base64 string

class ChatRequest(BaseModel):
    message: str = ""
    attachments: Optional[List[AttachmentPayload]] = None
    mode: Optional[str] = None
    tool_overrides: Optional[List[str]] = None

class ModeRequest(BaseModel):
    mode: str  # chat | plan | canva | agent

class UpdateSessionRequest(BaseModel):
    title: Optional[str] = None
    mode: Optional[str] = None

class WriteFileRequest(BaseModel):
    path: str
    content: str = ""
    create_directories: bool = True

class PathRequest(BaseModel):
    path: str

class RenameRequest(BaseModel):
    old_path: str
    new_path: str

class SearchRequest(BaseModel):
    query: str
    path: Optional[str] = None

class BindWorkspaceRequest(BaseModel):
    root: str

@app.post("/config")
async def configure_agent(config: ConfigRequest):
    _ensure_workspace_bound()
    try:
        applied = config.model_dump()
        _apply_llm_config(applied)
        return {"status": "configured", "provider": config.provider, "config": applied}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/config")
async def get_config():
    _ensure_workspace_bound()
    current = llm_config or _maybe_load_persisted_llm_config()
    stored = current or database.load_llm_config()
    return {"config": stored, "configured": bool(current and current.get("api_key"))}

@app.post("/health")
async def check_health(req: Optional[ConfigRequest] = None):
    # Check health of current config or provided config
    _ensure_workspace_bound()
    _maybe_load_persisted_llm_config()
    
    client_to_check = None
    check_model = None

    if req:
        # Create temp client
        try:
            if req.provider == "openai":
                client_to_check = OpenAIProvider(req.api_key, model=req.model or "gpt-4-turbo", base_url=req.base_url)
            elif req.provider == "anthropic":
                client_to_check = AnthropicProvider(req.api_key, model=req.model or "claude-3-opus-20240229", base_url=req.base_url)
            check_model = req.check_model
        except Exception as e:
             return {"status": "error", "message": str(e)}
    else:
        client_to_check = llm_client
        if llm_config:
            check_model = llm_config.get("check_model")
    
    if not client_to_check:
        return {"status": "error", "message": "Agent not configured"}
        
    is_healthy = await client_to_check.check_health(model=check_model)
    return {"status": "ok" if is_healthy else "error", "connected": is_healthy}

# --- Session Management ---

class SessionResponse(BaseModel):
    id: str
    title: str
    mode: str
    created_at: Any
    updated_at: Any

class CreateSessionRequest(BaseModel):
    title: str = "New Chat"
    mode: str = "chat"

@app.get("/sessions", response_model=List[SessionResponse])
async def list_sessions():
    _ensure_workspace_bound()
    return database.get_sessions()

@app.post("/sessions", response_model=SessionResponse)
async def create_session(req: CreateSessionRequest):
    _ensure_workspace_bound()
    return database.create_session(title=req.title, mode=req.mode)

@app.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    _ensure_workspace_bound()
    session = database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@app.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, req: UpdateSessionRequest):
    _ensure_workspace_bound()
    session = database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    updates: Dict[str, Any] = {}
    if req.title is not None:
        updates["title"] = req.title
    if req.mode is not None:
        if req.mode not in ["chat", "plan", "canva", "agent"]:
            raise HTTPException(status_code=400, detail="Invalid mode")
        updates["mode"] = req.mode

    updated = database.update_session_meta(session_id, **updates)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update session")
    return updated

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    _ensure_workspace_bound()
    database.delete_session(session_id)
    return {"status": "deleted"}

@app.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str):
    _ensure_workspace_bound()
    return database.get_messages(session_id)

@app.get("/sessions/{session_id}/logs")
async def get_session_logs(session_id: str):
    _ensure_workspace_bound()
    return database.get_logs(session_id)

@app.post("/sessions/{session_id}/chat")
async def chat_in_session(session_id: str, req: ChatRequest):
    global llm_client
    _ensure_workspace_bound()
    if not llm_client:
        raise HTTPException(status_code=400, detail="Agent not configured")
    
    session = database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Instantiate transient agent with history from DB
    agent = Agent(llm=llm_client, session_id=session_id)
    active_mode = req.mode or session['mode']
    agent.set_mode(active_mode)  # Set mode from session or incoming request
    agent._apply_tool_policy(req.tool_overrides)

    # Persist mode change if request overrides
    if req.mode and req.mode != session["mode"]:
        database.update_session_meta(session_id, mode=req.mode)
    
    async def generate():
        try:
            async for chunk in agent.chat(
                req.message, attachments=req.attachments, mode=active_mode, tool_overrides=req.tool_overrides
            ):
                yield chunk
        except Exception as e:
            yield f"Internal Error: {str(e)}"

    return StreamingResponse(generate(), media_type="text/plain")

# --- Workspace / File-system endpoints ---

@app.get("/workspace/structure")
async def workspace_structure(include_content: bool = False):
    try:
        _ensure_workspace_bound()
        return filesystem.get_current_project_structure(include_content=include_content)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/workspace/read")
async def workspace_read(path: str):
    try:
        _ensure_workspace_bound()
        return filesystem.read_file(path)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/workspace/write")
async def workspace_write(req: WriteFileRequest):
    try:
        _ensure_workspace_bound()
        return filesystem.write_file(req.path, req.content, create_directories=req.create_directories)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/workspace/root")
async def workspace_root():
    try:
        return {"root": filesystem.get_workspace_root(require=False)}
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/workspace/bind-root")
async def workspace_bind_root(req: BindWorkspaceRequest):
    try:
        applied = filesystem.set_workspace_root(req.root)
        database.init_db()
        return {"root": applied, "status": "ok", "data_dir": filesystem.get_project_data_dir(create=True)}
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/workspace/create-folder")
async def workspace_create_folder(req: PathRequest):
    try:
        _ensure_workspace_bound()
        return filesystem.create_folder(req.path)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/workspace/delete")
async def workspace_delete(req: PathRequest):
    try:
        _ensure_workspace_bound()
        return filesystem.delete_file(req.path)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/workspace/rename")
async def workspace_rename(req: RenameRequest):
    try:
        _ensure_workspace_bound()
        return filesystem.rename_file(req.old_path, req.new_path)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/workspace/search")
async def workspace_search(query: str, path: Optional[str] = None):
    try:
        _ensure_workspace_bound()
        return filesystem.search_in_files(query, path=path)
    except filesystem.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
