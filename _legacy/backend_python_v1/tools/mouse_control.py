import os
import sys
from typing import Dict, Any, Literal, Optional

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

# Safety fail-safe
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.5  # Add a small pause between PyAutoGUI commands

class MouseControlTool(BaseTool):
    name = "mouse_control"
    description = "Control the mouse to move, click, or drag."
    input_schema = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["move", "click", "double_click", "drag", "scroll"],
                "description": "The action to perform."
            },
            "x": {
                "type": "integer",
                "description": "The x coordinate to move/click/drag to."
            },
            "y": {
                "type": "integer",
                "description": "The y coordinate to move/click/drag to."
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "description": "The mouse button to click/drag with. Default is 'left'.",
                "default": "left"
            },
            "amount": {
                "type": "integer",
                "description": "Amount to scroll (for scroll action only). Positive is up, negative is down."
            }
        },
        "required": ["action"]
    }

    async def execute(
        self, 
        action: Literal["move", "click", "double_click", "drag", "scroll"], 
        x: Optional[int] = None, 
        y: Optional[int] = None,
        button: str = "left",
        amount: Optional[int] = None
    ) -> Dict[str, Any]:
        
        screen_width, screen_height = pyautogui.size()
        
        if action in ["move", "click", "double_click", "drag"]:
            if x is not None and y is not None:
                # Ensure coordinates are within screen bounds
                x = max(0, min(x, screen_width - 1))
                y = max(0, min(y, screen_height - 1))
            else:
                 # If no coordinates provided, use current position
                x, y = pyautogui.position()

        try:
            if action == "move":
                pyautogui.moveTo(x, y)
            elif action == "click":
                pyautogui.click(x, y, button=button)
            elif action == "double_click":
                pyautogui.doubleClick(x, y, button=button)
            elif action == "drag":
                pyautogui.dragTo(x, y, button=button)
            elif action == "scroll":
                if amount is None:
                    return {"status": "error", "message": "Amount is required for scroll action."}
                pyautogui.scroll(amount)
            
            return {
                "status": "success",
                "action": action,
                "position": {"x": x, "y": y} if action != "scroll" else None
            }
        except pyautogui.FailSafeException:
            return {"status": "error", "message": "FailSafe triggered from mouse movement."}
        except Exception as e:
            return {"status": "error", "message": str(e)}
