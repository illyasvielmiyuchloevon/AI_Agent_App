# Tool API Documentation

This document describes the available tools in the Node.js backend for the AI Agent App. These tools are designed to match the functionality of the original Python backend.

## 1. Filesystem Tools

### `write_to_file`
Writes content to a file. Overwrites existing content.
*   **Parameters**:
    *   `path` (string, required): Relative path to the file.
    *   `content` (string, required): Content to write.
    *   `create_directories` (boolean, optional): Create missing parent directories. Default: true.
*   **Returns**: Success message with file path.

### `read_file`
Reads content from a file.
*   **Parameters**:
    *   `path` (string, required): Relative path to the file.
*   **Returns**: File content (string).

### `edit_file`
Applies precise search/replace edits to a file.
*   **Parameters**:
    *   `path` (string, required): Relative path to the file.
    *   `edits` (array, required): List of edit objects.
        *   `search` (string, required): Exact text block to replace.
        *   `replace` (string, required): New text.
*   **Returns**: Success message.

### `list_files`
Lists all files in a directory (recursive).
*   **Parameters**:
    *   `path` (string, optional): Directory to list. Defaults to workspace root.
*   **Returns**: List of file paths and details.

### `create_folder`
Creates a new directory.
*   **Parameters**:
    *   `path` (string, required): Path of the folder to create.
*   **Returns**: Success message.

### `delete_file`
Deletes a file or directory.
*   **Parameters**:
    *   `path` (string, required): Path to delete.
*   **Returns**: Success message.

### `rename_file`
Renames or moves a file/directory.
*   **Parameters**:
    *   `old_path` (string, required): Current path.
    *   `new_path` (string, required): New path.
*   **Returns**: Success message.

### `search_in_files`
Searches for text across all files in a directory.
*   **Parameters**:
    *   `query` (string, required): Text to search for.
    *   `path` (string, optional): Scope search to this directory.
*   **Returns**: List of matches with file paths and line numbers.

### `get_current_project_structure`
Returns the full directory tree structure.
*   **Parameters**:
    *   `include_content` (boolean, optional): Include content for small text files.
*   **Returns**: JSON object representing the file tree.

## 2. Shell Tools

### `execute_shell`
Executes a shell command.
*   **Parameters**:
    *   `command` (string, required): Command to execute.
    *   `workdir` (string, optional): Working directory relative to workspace root.
*   **Returns**: Command output (stdout/stderr).

## 3. Desktop Tools

### `screen_capture`
Takes a screenshot of the desktop.
*   **Parameters**:
    *   `resize_factor` (number, optional): Scale factor (0.1 to 1.0). Default: 1.0.
*   **Returns**: Base64 encoded image (data URI).

### `keyboard_control`
Simulates keyboard input.
*   **Parameters**:
    *   `action` (string, required): 'type', 'press', 'hotkey', 'keyDown', 'keyUp'.
    *   `text` (string, optional): Text to type.
    *   `keys` (array<string>, optional): Keys to press.
*   **Returns**: Success message.

### `mouse_control`
Simulates mouse input.
*   **Parameters**:
    *   `action` (string, required): 'move', 'click', 'double_click', 'scroll', 'drag', 'position'.
    *   `x` (number, optional): X coordinate.
    *   `y` (number, optional): Y coordinate.
    *   `button` (string, optional): 'left', 'right', 'middle'.
    *   `clicks` (number, optional): Number of clicks.
*   **Returns**: Success message or current position.
