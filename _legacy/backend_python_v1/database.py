import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    # Normal package import path
    from . import filesystem
except ImportError:
    # Fallback for running inside backend/ without package context
    import filesystem  # type: ignore

DATA_FILE_NAME = "sessions.json"


def _now() -> str:
    return datetime.now().isoformat()


def _default_state() -> Dict[str, Any]:
    return {"sessions": [], "messages": {}, "logs": {}, "meta": {"message_seq": 0, "log_seq": 0}}


def _data_file_path() -> str:
    data_dir = filesystem.get_project_data_dir(create=True)
    return os.path.join(data_dir, DATA_FILE_NAME)


def _load_state() -> Dict[str, Any]:
    path = _data_file_path()
    if not os.path.exists(path):
        state = _default_state()
        _save_state(state)
        return state
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except json.JSONDecodeError:
        raw = _default_state()
    return _apply_defaults(raw)


def _apply_defaults(state: Dict[str, Any]) -> Dict[str, Any]:
    state = state or {}
    state.setdefault("sessions", [])
    state.setdefault("messages", {})
    state.setdefault("logs", {})
    meta = state.setdefault("meta", {})
    meta.setdefault("message_seq", 0)
    meta.setdefault("log_seq", 0)
    return state


def _save_state(state: Dict[str, Any]):
    path = _data_file_path()
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def init_db():
    """
    Ensure the per-project data file exists. No-op if workspace is not yet bound.
    """
    try:
        _save_state(_load_state())
    except filesystem.WorkspaceError:
        # Defer until a project is bound
        return


# Session Operations
def create_session(title: str = "New Chat", mode: str = "chat") -> Dict[str, Any]:
    state = _load_state()
    session_id = str(uuid.uuid4())
    now = _now()
    session = {
        "id": session_id,
        "title": title,
        "mode": mode,
        "created_at": now,
        "updated_at": now,
    }
    state["sessions"].insert(0, session)
    state["messages"][session_id] = []
    state["logs"][session_id] = []
    _save_state(state)
    return session


def get_sessions() -> List[Dict[str, Any]]:
    state = _load_state()
    return sorted(state["sessions"], key=lambda s: s.get("updated_at", ""), reverse=True)


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    state = _load_state()
    return next((s for s in state["sessions"] if s["id"] == session_id), None)


def delete_session(session_id: str):
    state = _load_state()
    state["sessions"] = [s for s in state["sessions"] if s["id"] != session_id]
    state["messages"].pop(session_id, None)
    state["logs"].pop(session_id, None)
    _save_state(state)


def update_session_title(session_id: str, title: str):
    update_session_meta(session_id, title=title)


def update_session_meta(session_id: str, title: Optional[str] = None, mode: Optional[str] = None) -> Optional[Dict[str, Any]]:
    state = _load_state()
    session = next((s for s in state["sessions"] if s["id"] == session_id), None)
    if not session:
        return None
    if title is not None:
        session["title"] = title
    if mode is not None:
        session["mode"] = mode
    session["updated_at"] = _now()
    _save_state(state)
    return session


# Message Operations
def add_message(session_id: str, role: str, content: Any):
    state = _load_state()
    if session_id not in state["messages"]:
        state["messages"][session_id] = []
    seq = state["meta"].get("message_seq", 0) + 1
    state["meta"]["message_seq"] = seq
    entry = {
        "id": seq,
        "session_id": session_id,
        "role": role,
        "content": content if isinstance(content, (str, dict, list)) else json.dumps(content),
        "created_at": _now(),
    }
    state["messages"][session_id].append(entry)

    for sess in state["sessions"]:
        if sess["id"] == session_id:
            sess["updated_at"] = _now()
            break

    _save_state(state)


def get_messages(session_id: str) -> List[Dict[str, Any]]:
    state = _load_state()
    messages = state["messages"].get(session_id, [])
    output: List[Dict[str, Any]] = []
    for msg in messages:
        parsed = dict(msg)
        try:
            if isinstance(parsed["content"], str):
                parsed["content"] = json.loads(parsed["content"])
        except Exception:
            pass
        output.append(parsed)
    return sorted(output, key=lambda m: m.get("id", 0))


# Log Operations
def add_log(session_id: Optional[str], provider: str, method: str, url: str,
            request_body: Any, response_body: Any, status_code: int, success: bool,
            parsed_success: Optional[bool] = None, parse_error: Optional[str] = None):
    state = _load_state()
    seq = state["meta"].get("log_seq", 0) + 1
    state["meta"]["log_seq"] = seq
    entry = {
        "id": seq,
        "session_id": session_id,
        "provider": provider,
        "method": method,
        "url": url,
        "request_body": request_body,
        "response_body": response_body,
        "status_code": status_code,
        "success": success,
        "parsed_success": parsed_success,
        "parse_error": parse_error,
        "created_at": _now(),
    }
    bucket = state["logs"].setdefault(session_id or "__global__", [])
    bucket.append(entry)
    _save_state(state)


def get_logs(session_id: str) -> List[Dict[str, Any]]:
    state = _load_state()
    logs = state["logs"].get(session_id, [])
    output: List[Dict[str, Any]] = []
    for log in logs:
        parsed = dict(log)
        try:
            if parsed.get("request_body") and isinstance(parsed["request_body"], str):
                parsed["request_body"] = json.loads(parsed["request_body"])
        except Exception:
            pass
        try:
            if parsed.get("response_body") and isinstance(parsed["response_body"], str):
                parsed["response_body"] = json.loads(parsed["response_body"])
        except Exception:
            pass
        output.append(parsed)
    return sorted(output, key=lambda l: l.get("created_at", ""), reverse=True)


# LLM Config Persistence
LLM_CONFIG_FILE = "llm_config.json"


def _llm_config_path() -> str:
    data_dir = filesystem.get_project_data_dir(create=True)
    return os.path.join(data_dir, LLM_CONFIG_FILE)


def load_llm_config() -> Optional[Dict[str, Any]]:
    """
    Load the persisted LLM configuration for the active workspace.
    Returns None if not stored yet.
    """
    path = _llm_config_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
            if not isinstance(raw, dict):
                return None
            return raw
    except Exception:
        return None


def save_llm_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Persist the given LLM config to disk atomically.
    """
    path = _llm_config_path()
    tmp_path = f"{path}.tmp"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)
    return config
