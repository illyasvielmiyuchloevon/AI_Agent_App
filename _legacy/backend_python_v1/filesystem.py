import contextvars
import os
import re
import shutil
from functools import lru_cache
from typing import Any, Dict, List, Optional

# Workspace root can be overridden for tests, otherwise left unset until bound by the client
_ROOT_ENV = os.getenv("BOUND_WORKSPACE_ROOT") or os.getenv("WORKSPACE_ROOT")
_GLOBAL_WORKSPACE_ROOT = os.path.abspath(_ROOT_ENV) if _ROOT_ENV else None
_REQUEST_WORKSPACE_ROOT: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "request_workspace_root", default=None
)
MAX_READ_BYTES = int(os.getenv("WORKSPACE_MAX_READ_BYTES", "600000"))


class WorkspaceError(RuntimeError):
    """Lightweight error wrapper for workspace operations."""


def _normalize_root(root_path: str) -> str:
    """Normalize and validate a workspace root path."""
    if not root_path:
        raise WorkspaceError("Workspace root path is required")
    expanded = os.path.expanduser(root_path)
    if not os.path.isabs(expanded):
        raise WorkspaceError("Workspace root must be an absolute path on the server")
    return os.path.abspath(expanded)


# If an env-provided root is relative, drop it to avoid silently binding to the backend folder.
if _ROOT_ENV and not os.path.isabs(os.path.expanduser(_ROOT_ENV)):
    _GLOBAL_WORKSPACE_ROOT = None


def _active_root() -> Optional[str]:
    return _REQUEST_WORKSPACE_ROOT.get() or _GLOBAL_WORKSPACE_ROOT


def get_workspace_root(require: bool = True) -> Optional[str]:
    """
    Return the active workspace root (request-scoped first, then global).
    If require is True and no root is bound, raise a WorkspaceError.
    """
    root = _active_root()
    if require and not root:
        raise WorkspaceError("Workspace root is not bound. Please select a project folder first.")
    return root


def set_workspace_root(root_path: str) -> str:
    """Update the global workspace root and invalidate caches."""
    global _GLOBAL_WORKSPACE_ROOT
    abs_root = _normalize_root(root_path)
    if not os.path.exists(abs_root):
        # Auto-create missing workspace to avoid interactive prompts
        os.makedirs(abs_root, exist_ok=True)
    if not os.path.isdir(abs_root):
        raise WorkspaceError(f"Workspace root is not a directory: {root_path}")
    _GLOBAL_WORKSPACE_ROOT = abs_root
    _REQUEST_WORKSPACE_ROOT.set(abs_root)
    _gitignore_rules.cache_clear()
    os.makedirs(get_project_data_dir(create=True), exist_ok=True)
    return abs_root


def set_request_workspace_root(root_path: str) -> str:
    """Bind workspace root for the current request context only."""
    abs_root = _normalize_root(root_path)
    if not os.path.exists(abs_root):
        os.makedirs(abs_root, exist_ok=True)
    if not os.path.isdir(abs_root):
        raise WorkspaceError(f"Workspace root is not a directory: {root_path}")
    _REQUEST_WORKSPACE_ROOT.set(abs_root)
    return abs_root


def clear_request_workspace_root():
    """Reset the request-scoped workspace root."""
    _REQUEST_WORKSPACE_ROOT.set(None)


def get_project_data_dir(create: bool = False) -> str:
    """
    Return the .aichat folder path for the active workspace.
    If create is True, ensure the directory exists.
    """
    root = get_workspace_root()
    data_dir = os.path.join(root, ".aichat")
    if create:
        os.makedirs(data_dir, exist_ok=True)
    return data_dir


def _resolve_path(path: str) -> str:
    root = get_workspace_root()
    if path is None:
        raise WorkspaceError("Path is required")
    if path == "":
        path = "."
    if os.path.isabs(path):
        raise WorkspaceError("Absolute path access is not allowed")
    norm = os.path.normpath(path)
    if norm.startswith("..") or norm.startswith("\\..") or norm.startswith("/.."):
        raise WorkspaceError("Path outside workspace root is not allowed")
    candidate = os.path.abspath(os.path.join(root, norm))
    if not candidate.startswith(root):
        raise WorkspaceError("Path outside workspace root is not allowed")
    return candidate


def _relative(path: str) -> str:
    root = get_workspace_root()
    return os.path.relpath(path, root)


def _ensure_parent(path: str):
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


def read_file(path: str) -> Dict[str, Any]:
    abs_path = _resolve_path(path)
    if not os.path.exists(abs_path):
        raise WorkspaceError(f"File not found: {path}")
    if os.path.isdir(abs_path):
        raise WorkspaceError("Path points to a directory, expected file")

    with open(abs_path, "rb") as f:
        raw = f.read()

    truncated = False
    if len(raw) > MAX_READ_BYTES:
        raw = raw[:MAX_READ_BYTES]
        truncated = True

    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("utf-8", errors="replace")

    return {"path": _relative(abs_path), "content": content, "truncated": truncated}


def write_file(path: str, content: str, create_directories: bool = True) -> Dict[str, Any]:
    abs_path = _resolve_path(path)
    if create_directories:
        _ensure_parent(abs_path)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content or "")
    if os.path.basename(abs_path) == ".gitignore":
        _gitignore_rules.cache_clear()
    return {"path": _relative(abs_path), "bytes": len(content or "")}


def list_files(path: Optional[str] = ".") -> List[Dict[str, Any]]:
    base = _resolve_path(path or ".")
    if not os.path.exists(base):
        raise WorkspaceError(f"Path does not exist: {path or base}")

    entries: List[Dict[str, Any]] = []
    ignore_rules = _gitignore_rules_for_current()
    if os.path.isfile(base):
        stat = os.stat(base)
        rel = _relative(base)
        if _is_ignored(rel, ignore_rules):
            return entries
        entries.append(
            {
                "path": rel,
                "type": "file",
                "size": stat.st_size,
            }
        )
        return entries

    for root, dirs, files in os.walk(base):
        dirs.sort()
        files.sort()
        for d in dirs:
            abs_dir = os.path.join(root, d)
            rel = _relative(abs_dir)
            if _is_ignored(rel, ignore_rules):
                continue
            entries.append({"path": rel, "type": "dir"})
        for f in files:
            abs_file = os.path.join(root, f)
            stat = os.stat(abs_file)
            rel = _relative(abs_file)
            if _is_ignored(rel, ignore_rules):
                continue
            entries.append(
                {
                    "path": rel,
                    "type": "file",
                    "size": stat.st_size,
                }
            )
    return entries


def list_file_paths(path: Optional[str] = ".") -> List[str]:
    return [entry["path"] for entry in list_files(path)]


def create_folder(path: str) -> Dict[str, Any]:
    abs_path = _resolve_path(path)
    os.makedirs(abs_path, exist_ok=True)
    return {"path": _relative(abs_path), "created": True}


def delete_file(path: str) -> Dict[str, Any]:
    abs_path = _resolve_path(path)
    if not os.path.exists(abs_path):
        raise WorkspaceError(f"Path not found: {path}")
    if os.path.basename(abs_path) == ".gitignore":
        _gitignore_rules.cache_clear()
    if os.path.isdir(abs_path):
        shutil.rmtree(abs_path)
    else:
        os.remove(abs_path)
    return {"path": _relative(abs_path), "deleted": True}


def rename_file(old_path: str, new_path: str) -> Dict[str, Any]:
    abs_old = _resolve_path(old_path)
    abs_new = _resolve_path(new_path)
    _ensure_parent(abs_new)
    os.rename(abs_old, abs_new)
    if ".gitignore" in {os.path.basename(abs_old), os.path.basename(abs_new)}:
        _gitignore_rules.cache_clear()
    return {"from": _relative(abs_old), "to": _relative(abs_new)}


def _iter_text_files(base: str) -> List[str]:
    entries = list_files(base)
    return [e["path"] for e in entries if e["type"] == "file"]


def search_in_files(query: str, path: Optional[str] = ".", max_results: int = 200) -> Dict[str, Any]:
    if not query:
        raise WorkspaceError("Query is required")
    base = _resolve_path(path or ".")
    results: List[Dict[str, Any]] = []
    pattern = re.compile(re.escape(query), re.IGNORECASE)

    for rel_path in _iter_text_files(base):
        try:
            data = read_file(rel_path)
        except WorkspaceError:
            continue
        lines = data["content"].splitlines()
        for idx, line in enumerate(lines, 1):
            if pattern.search(line):
                results.append(
                    {"path": rel_path, "line": idx, "preview": line.strip()}
                )
                if len(results) >= max_results:
                    return {"query": query, "results": results}
    return {"query": query, "results": results}


def _entry_candidates(flat_files: List[str]) -> List[str]:
    priority = [
        "index.html",
        os.path.join("public", "index.html"),
        os.path.join("src", "index.html"),
        "main.html",
        "main.py",
        "app.py",
        "server.py",
        "app.jsx",
        "app.tsx",
        "src/App.jsx",
        "src/main.jsx",
        "src/main.tsx",
    ]
    files_lower = {f.lower(): f for f in flat_files}
    candidates: List[str] = []
    for target in priority:
        found = next((files_lower[p] for p in files_lower if p.endswith(target.lower())), None)
        if found and found not in candidates:
            candidates.append(found)
    if not candidates and flat_files:
        candidates.append(flat_files[0])
    return candidates


@lru_cache(maxsize=32)
def _gitignore_rules(root: str) -> List[str]:
    path = os.path.join(root, ".gitignore")
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f.readlines()]
            return [line.rstrip("/").lstrip("./") for line in lines if line and not line.startswith("#")]
    except OSError:
        return []


def _gitignore_rules_for_current() -> List[str]:
    root = get_workspace_root()
    return _gitignore_rules(root)


def _is_ignored(rel_path: str, rules: List[str]) -> bool:
    return any(rel_path == rule or rel_path.startswith(f"{rule}/") for rule in rules)


def get_current_project_structure(include_content: bool = False) -> Dict[str, Any]:
    entries = list_files()
    flat_files = [e["path"] for e in entries if e["type"] == "file"]
    root = get_workspace_root()
    payload: Dict[str, Any] = {
        "root": root,
        "entries": entries,
        "entry_candidates": _entry_candidates(flat_files),
    }

    if include_content:
        files_with_content: List[Dict[str, Any]] = []
        for rel_path in flat_files:
            try:
                files_with_content.append(read_file(rel_path))
            except WorkspaceError:
                continue
        payload["files"] = files_with_content
    return payload


def get_project_structure(include_content: bool = False) -> Dict[str, Any]:
    """Alias for get_current_project_structure to match tool contract."""
    return get_current_project_structure(include_content)


def edit_file(path: str, edits: List[Dict[str, str]]) -> Dict[str, Any]:
    """
    Apply a list of search/replace edits to a file.
    Each search must match a contiguous block exactly; otherwise raises WorkspaceError.
    """
    if not edits:
        raise WorkspaceError("edits 列表不能为空")
    # Normalize and validate payload early
    normalized = []
    for idx, item in enumerate(edits, 1):
        search = item.get("search")
        replace = item.get("replace", "")
        if not search:
            raise WorkspaceError(f"第 {idx} 个编辑缺少 search 内容")
        normalized.append((search, replace))

    data = read_file(path)
    content = data["content"]
    applied = 0

    for search, replace in normalized:
        pos = content.find(search)
        if pos == -1:
            raise WorkspaceError("未找到匹配内容，请检查 search 代码是否正确")
        content = content[:pos] + replace + content[pos + len(search):]
        applied += 1

    write_file(path, content, create_directories=True)
    return {
        "status": "ok",
        "path": data["path"],
        "applied": applied
    }
