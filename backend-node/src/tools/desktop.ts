import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseToolImplementation } from '../core/base_tool';

const execAsync = promisify(exec);

async function runPythonScript(script: string): Promise<any> {
    const b64Script = Buffer.from(script).toString('base64');
    const pythonCmd = `import base64; exec(base64.b64decode('${b64Script}'))`;
    
    try {
        const { stdout, stderr } = await execAsync(`python -c "${pythonCmd}"`);
        // We expect JSON output on the last line or mainly in stdout
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        return lastLine;
    } catch (e: any) {
        // If the script fails, e.message contains the command, e.stderr contains the error output
        throw new Error(`Python execution failed: ${e.stderr || e.message}`);
    }
}

export class KeyboardControlTool extends BaseToolImplementation {
    name = "keyboard_control";
    description = "Control the keyboard to type text or press keys.";
    input_schema = {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["type", "press", "hotkey"],
                description: "The action to perform."
            },
            text: {
                type: "string",
                description: "The text to type (for type action)."
            },
            keys: {
                type: "array",
                items: { type: "string" },
                description: "The keys to press or hotkey combination (e.g. ['ctrl', 'c'])."
            },
            interval: {
                type: "number",
                description: "Interval between key presses in seconds. Default 0.05.",
                default: 0.05
            }
        },
        required: ["action"]
    };

    async execute(args: any, _context: { sessionId?: string } = {}): Promise<any> {
        const script = `
import pyautogui
import json
import sys

# Safety settings
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.5

try:
    args = ${JSON.stringify(args)}
    action = args.get('action')
    interval = args.get('interval', 0.05)
    
    if action == 'type':
        if not args.get('text'):
            raise ValueError("Text is required for type action")
        pyautogui.write(args['text'], interval=interval)
        
    elif action == 'press':
        if not args.get('keys'):
            raise ValueError("Keys are required for press action")
        pyautogui.press(args['keys'], interval=interval)
        
    elif action == 'hotkey':
        if not args.get('keys'):
            raise ValueError("Keys are required for hotkey action")
        pyautogui.hotkey(*args['keys'])
        
    print(json.dumps({"status": "success", "action": action}))
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))
`;
        try {
            const result = await runPythonScript(script);
            return JSON.parse(result);
        } catch (e: any) {
            return { status: "error", message: e.message };
        }
    }
}

export class MouseControlTool extends BaseToolImplementation {
    name = "mouse_control";
    description = "Control the mouse to move, click, or drag.";
    input_schema = {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["move", "click", "double_click", "drag", "scroll"],
                description: "The action to perform."
            },
            x: {
                type: "integer",
                description: "The x coordinate to move/click/drag to."
            },
            y: {
                type: "integer",
                description: "The y coordinate to move/click/drag to."
            },
            button: {
                type: "string",
                enum: ["left", "right", "middle"],
                description: "The mouse button to click/drag with. Default is 'left'.",
                default: "left"
            },
            amount: {
                type: "integer",
                description: "Amount to scroll (for scroll action only). Positive is up, negative is down."
            }
        },
        required: ["action"]
    };

    async execute(args: any, _context: { sessionId?: string } = {}): Promise<any> {
        const script = `
import pyautogui
import json
import sys

# Safety settings
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.5

try:
    args = ${JSON.stringify(args)}
    action = args.get('action')
    x = args.get('x')
    y = args.get('y')
    button = args.get('button', 'left')
    amount = args.get('amount')
    
    screen_width, screen_height = pyautogui.size()
    
    if action in ["move", "click", "double_click", "drag"]:
        if x is not None and y is not None:
            # Ensure coordinates are within screen bounds
            x = max(0, min(x, screen_width - 1))
            y = max(0, min(y, screen_height - 1))
        else:
             # If no coordinates provided, use current position
            x, y = pyautogui.position()

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
            raise ValueError("Amount is required for scroll action.")
        pyautogui.scroll(amount)
    
    result = {
        "status": "success", 
        "action": action
    }
    if action != "scroll":
        result["position"] = {"x": x, "y": y}
        
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))
`;
        try {
            const result = await runPythonScript(script);
            return JSON.parse(result);
        } catch (e: any) {
            return { status: "error", message: e.message };
        }
    }
}
