import os
import sys
from typing import Dict, Any, Literal, List, Union, Optional

import pyautogui

try:
    from ..core.base_tool import BaseTool
except ImportError:
    if __package__ and __package__.startswith("backend"):
        raise
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from core.base_tool import BaseTool

class KeyboardControlTool(BaseTool):
    name = "keyboard_control"
    description = "Control the keyboard to type text or press keys."
    input_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["type", "press", "hotkey"],
                "description": "The action to perform."
            },
            "text": {
                "type": "string",
                "description": "The text to type (for type action)."
            },
            "keys": {
                "type": "array",
                "items": {"type": "string"},
                "description": "The keys to press or hotkey combination (e.g. ['ctrl', 'c'])."
            },
            "interval": {
                "type": "number",
                "description": "Interval between key presses in seconds. Default 0.05.",
                "default": 0.05
            }
        },
        "required": ["action"]
    }

    async def execute(
        self, 
        action: Literal["type", "press", "hotkey"], 
        text: Optional[str] = None, 
        keys: Optional[List[str]] = None,
        interval: float = 0.05
    ) -> Dict[str, Any]:
        
        try:
            if action == "type":
                if text is None:
                    return {"status": "error", "message": "Text is required for type action."}
                pyautogui.write(text, interval=interval)
                
            elif action == "press":
                if keys is None:
                    return {"status": "error", "message": "Keys are required for press action."}
                pyautogui.press(keys, interval=interval)
                
            elif action == "hotkey":
                if keys is None:
                    return {"status": "error", "message": "Keys are required for hotkey action."}
                pyautogui.hotkey(*keys)
            
            return {
                "status": "success",
                "action": action
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
