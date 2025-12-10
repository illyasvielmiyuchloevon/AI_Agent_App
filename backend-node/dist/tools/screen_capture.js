"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenCaptureTool = void 0;
const screenshot = require('screenshot-desktop');
const sharp_1 = __importDefault(require("sharp"));
const base_tool_1 = require("../core/base_tool");
class ScreenCaptureTool extends base_tool_1.BaseToolImplementation {
    name = "screen_capture";
    description = "Capture a screenshot of the primary monitor. Returns a base64 encoded image.";
    input_schema = {
        type: "object",
        properties: {
            resize_factor: {
                type: "number",
                description: "Factor to resize the screenshot by (0.0 to 1.0). Default is 0.5.",
                default: 0.5
            }
        },
        required: []
    };
    async execute(args) {
        const resizeFactor = args.resize_factor ?? 0.5;
        try {
            const imgBuffer = await screenshot({ format: 'png' });
            let finalBuffer = imgBuffer;
            let width = 0;
            let height = 0;
            const metadata = await (0, sharp_1.default)(imgBuffer).metadata();
            width = metadata.width || 0;
            height = metadata.height || 0;
            if (resizeFactor !== 1.0) {
                const newWidth = Math.round(width * resizeFactor);
                finalBuffer = await (0, sharp_1.default)(imgBuffer)
                    .resize({ width: newWidth })
                    .jpeg({ quality: 85 })
                    .toBuffer();
            }
            else {
                finalBuffer = await (0, sharp_1.default)(imgBuffer)
                    .jpeg({ quality: 85 })
                    .toBuffer();
            }
            // Re-read metadata after resize/convert
            const newMeta = await (0, sharp_1.default)(finalBuffer).metadata();
            width = newMeta.width || 0;
            height = newMeta.height || 0;
            // Convert to base64
            const base64Image = finalBuffer.toString('base64');
            return {
                type: "image",
                data: `data:image/jpeg;base64,${base64Image}`,
                width: width,
                height: height
            };
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
}
exports.ScreenCaptureTool = ScreenCaptureTool;
