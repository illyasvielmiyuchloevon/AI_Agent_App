import os
import sys
from typing import Any, Dict, Optional

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


def _wrap_error(err: Exception) -> Dict[str, Any]:
    return {"status": "error", "message": str(err)}


class ReadFileTool(BaseTool):
    name = "read_file"
    description = "Read a text file from the workspace using an absolute or relative path."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute or relative file path"},
        },
        "required": ["path"],
    }

    async def execute(self, path: str) -> Dict[str, Any]:
        try:
            result = filesystem.read_file(path)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class WriteFileTool(BaseTool):
    name = "write_file"
    description = "Write content to a workspace file, creating parent folders automatically."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute or relative file path"},
            "content": {"type": "string", "description": "Full file content to write"},
            "create_directories": {
                "type": "boolean",
                "description": "Whether to auto-create parent folders",
                "default": True,
            },
        },
        "required": ["path", "content"],
    }

    async def execute(self, path: str, content: str, create_directories: bool = True) -> Dict[str, Any]:
        try:
            result = filesystem.write_file(path, content, create_directories=create_directories)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class EditFileTool(BaseTool):
    name = "edit_file"
    description = "Apply precise search/replace edits to a workspace file without rewriting the whole file."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Relative file path inside the workspace"},
            "edits": {
                "type": "array",
                "description": "List of exact search/replace edits to apply in order",
                "items": {
                    "type": "object",
                    "properties": {
                        "search": {"type": "string", "description": "Exact contiguous block to replace"},
                        "replace": {"type": "string", "description": "Replacement text"},
                        "description": {"type": "string", "description": "Optional description of the change"}
                    },
                    "required": ["search", "replace"]
                },
                "minItems": 1
            }
        },
        "required": ["path", "edits"]
    }

    async def execute(self, path: str, edits: Any) -> Dict[str, Any]:
        try:
            result = filesystem.edit_file(path, edits)
            result["status"] = "ok"
            result["message"] = f"已编辑 {result['path']}（{result.get('applied', 0)} 处修改）"
            return result
        except Exception as e:
            return _wrap_error(e)


class ListFilesTool(BaseTool):
    name = "list_files"
    description = "List files and folders under the given path (recursive)."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Folder path to list. Leave empty for workspace root.",
            },
        },
        "required": [],
    }

    async def execute(self, path: Optional[str] = ".") -> Dict[str, Any]:
        try:
            tree = filesystem.list_files(path)
            return {
                "status": "ok",
                "items": [item["path"] if isinstance(item, dict) else str(item) for item in tree],
                "tree": tree,
            }
        except Exception as e:
            return _wrap_error(e)


class CreateFolderTool(BaseTool):
    name = "create_folder"
    description = "Create a folder (and parents) inside the workspace."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Folder path to create",
            }
        },
        "required": ["path"],
    }

    async def execute(self, path: str) -> Dict[str, Any]:
        try:
            result = filesystem.create_folder(path)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class DeleteFileTool(BaseTool):
    name = "delete_file"
    description = "Delete a file or folder from the workspace."
    input_schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to delete"},
        },
        "required": ["path"],
    }

    async def execute(self, path: str) -> Dict[str, Any]:
        try:
            result = filesystem.delete_file(path)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class RenameFileTool(BaseTool):
    name = "rename_file"
    description = "Rename or move a file/folder within the workspace."
    input_schema = {
        "type": "object",
        "properties": {
            "old_path": {"type": "string", "description": "Existing file/folder path"},
            "new_path": {"type": "string", "description": "New path for the item"},
        },
        "required": ["old_path", "new_path"],
    }

    async def execute(self, old_path: str, new_path: str) -> Dict[str, Any]:
        try:
            result = filesystem.rename_file(old_path, new_path)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class SearchInFilesTool(BaseTool):
    name = "search_in_files"
    description = "Search for a text query across workspace files."
    input_schema = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search term"},
            "path": {
                "type": "string",
                "description": "Optional sub-folder to scope the search",
            },
        },
        "required": ["query"],
    }

    async def execute(self, query: str, path: Optional[str] = ".") -> Dict[str, Any]:
        try:
            result = filesystem.search_in_files(query, path=path)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class ProjectStructureTool(BaseTool):
    name = "get_current_project_structure"
    description = "Return the current workspace tree and top-level entry candidates."
    input_schema = {
        "type": "object",
        "properties": {
            "include_content": {
                "type": "boolean",
                "description": "Whether to include file contents for text files",
                "default": False,
            }
        },
        "required": [],
    }

    async def execute(self, include_content: bool = False) -> Dict[str, Any]:
        try:
            result = filesystem.get_current_project_structure(include_content=include_content)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)


class ProjectStructureAliasTool(BaseTool):
    name = "get_project_structure"
    description = "Alias for get_current_project_structure. Returns the workspace tree."
    input_schema = ProjectStructureTool.input_schema

    async def execute(self, include_content: bool = False) -> Dict[str, Any]:
        try:
            result = filesystem.get_project_structure(include_content=include_content)
            result["status"] = "ok"
            return result
        except Exception as e:
            return _wrap_error(e)
