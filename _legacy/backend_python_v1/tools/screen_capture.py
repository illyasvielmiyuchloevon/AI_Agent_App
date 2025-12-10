import base64
import io
import os
import sys
from typing import Dict, Any

import mss
from PIL import Image

try:
    from ..core.base_tool import BaseTool
except ImportError:
    # Fallback when imported as a top-level module (no parent package)
    if __package__ and __package__.startswith("backend"):
        raise
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from core.base_tool import BaseTool

class ScreenCaptureTool(BaseTool):
    name = "screen_capture"
    description = "Capture a screenshot of the primary monitor. Returns a base64 encoded image."
    input_schema = {
        "type": "object",
        "properties": {
            "resize_factor": {
                "type": "number",
                "description": "Factor to resize the screenshot by (0.0 to 1.0). Default is 0.5.",
                "default": 0.5
            }
        },
        "required": []
    }

    async def execute(self, resize_factor: float = 0.5) -> Dict[str, Any]:
        with mss.mss() as sct:
            # Capture the primary monitor
            monitor = sct.monitors[1]
            sct_img = sct.grab(monitor)

            # Convert to PIL Image
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")

            # Resize if needed
            if resize_factor != 1.0:
                new_size = (int(img.width * resize_factor), int(img.height * resize_factor))
                img = img.resize(new_size, Image.Resampling.LANCZOS)

            # Convert to base64
            buffered = io.BytesIO()
            img.save(buffered, format="JPEG", quality=85)
            img_str = base64.b64encode(buffered.getvalue()).decode()

            return {
                "type": "image",
                "data": f"data:image/jpeg;base64,{img_str}",
                "width": img.width,
                "height": img.height
            }
