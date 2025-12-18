"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiToolExecutor = void 0;
const tool_registry_1 = require("../core/tool_registry");
const filesystem_1 = require("../tools/filesystem");
const shell_1 = require("../tools/shell");
const screen_capture_1 = require("../tools/screen_capture");
const desktop_1 = require("../tools/desktop");
class AiToolExecutor {
    registry;
    tools;
    constructor() {
        this.registry = new tool_registry_1.ToolRegistry();
        this.tools = [
            new filesystem_1.ReadFileTool(),
            new filesystem_1.WriteFileTool(),
            new filesystem_1.ListFilesTool(),
            new filesystem_1.EditFileTool(),
            new filesystem_1.CreateFolderTool(),
            new filesystem_1.DeleteFileTool(),
            new filesystem_1.RenameFileTool(),
            new filesystem_1.SearchInFilesTool(),
            new filesystem_1.ProjectStructureTool(),
            new shell_1.ExecuteShellTool(),
            new screen_capture_1.ScreenCaptureTool(),
            new desktop_1.KeyboardControlTool(),
            new desktop_1.MouseControlTool()
        ];
        this.tools.forEach(t => this.registry.register(t));
    }
    async execute(toolName, args, sessionId) {
        return this.registry.execute(toolName, args, sessionId);
    }
}
exports.AiToolExecutor = AiToolExecutor;
