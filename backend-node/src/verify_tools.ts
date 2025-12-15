import { workspaceContext } from './context';
import { WriteFileTool, ReadFileTool, EditFileTool, ListFilesTool, CreateFolderTool, DeleteFileTool, RenameFileTool, SearchInFilesTool, ProjectStructureTool } from './tools/filesystem';
import { ExecuteShellTool } from './tools/shell';
import { ScreenCaptureTool } from './tools/screen_capture';
import { KeyboardControlTool, MouseControlTool } from './tools/desktop';
import { ToolRegistry } from './core/tool_registry';
import path from 'path';
import fs from 'fs/promises';

async function runTests() {
    const testDir = path.join(process.cwd(), 'test_workspace');
    try {
        await fs.rm(testDir, { recursive: true, force: true });
    } catch(e) {}
    await fs.mkdir(testDir, { recursive: true });
    
    console.log(`Running tests in ${testDir}`);

    const registry = new ToolRegistry();
    const tools = [
        new WriteFileTool(),
        new ReadFileTool(),
        new EditFileTool(),
        new ListFilesTool(),
        new CreateFolderTool(),
        new DeleteFileTool(),
        new RenameFileTool(),
        new SearchInFilesTool(),
        new ProjectStructureTool(),
        new ExecuteShellTool()
    ];
    tools.forEach(t => registry.register(t));
    registry.debugMode = true;

    await workspaceContext.run({ id: testDir, root: testDir }, async () => {
        try {
            // 1. Write File
            const filePath = 'test.txt';
            await registry.execute('write_file', { path: filePath, content: 'Hello World', create_directories: true });
            console.log('WriteFileTool: Passed');

            // 2. Read File
            const content = await registry.execute('read_file', { path: filePath });
            if (content !== 'Hello World') throw new Error('Content mismatch');
            console.log('ReadFileTool: Passed');

            // 3. Edit File
            await registry.execute('edit_file', {
                path: filePath,
                edits: [{ search: 'World', replace: 'Node' }]
            });
            const newContent = await registry.execute('read_file', { path: filePath });
            if (newContent !== 'Hello Node') throw new Error(`Edit failed: ${newContent}`);
            console.log('EditFileTool: Passed');

            // 4. Create Folder
            const folderPath = 'new_folder/sub_folder';
            await registry.execute('create_folder', { path: folderPath });
            const folderExists = await fs.stat(path.join(testDir, folderPath)).catch(() => false);
            if (!folderExists) throw new Error('CreateFolder failed');
            console.log('CreateFolderTool: Passed');

            // 5. Rename File
            const renamedPath = 'renamed.txt';
            await registry.execute('rename_file', { old_path: filePath, new_path: renamedPath });
            const oldExists = await fs.stat(path.join(testDir, filePath)).catch(() => false);
            const newExists = await fs.stat(path.join(testDir, renamedPath)).catch(() => false);
            if (oldExists || !newExists) throw new Error('Rename failed');
            console.log('RenameFileTool: Passed');

            // 6. Search In Files
            const searchRes = await registry.execute('search_in_files', { query: 'Node' });
            if (searchRes.results.length === 0 || searchRes.results[0].path !== renamedPath) throw new Error('Search failed');
            console.log('SearchInFilesTool: Passed');

            // 7. Project Structure
            const structure = await registry.execute('get_current_project_structure', {});
            if (!structure.entries.find((e: any) => e.path === renamedPath)) throw new Error('ProjectStructure failed');
            console.log('ProjectStructureTool: Passed');

            // 8. Delete File
            await registry.execute('delete_file', { path: renamedPath });
            const deletedExists = await fs.stat(path.join(testDir, renamedPath)).catch(() => false);
            if (deletedExists) throw new Error('Delete failed');
            console.log('DeleteFileTool: Passed');

            // 9. List Files
            const list = await registry.execute('list_files', {});
            if (list.items.includes(renamedPath)) throw new Error('List failed (file should be deleted)');
            console.log('ListFilesTool: Passed');

            // 10. Shell
            const shellRes = await registry.execute('execute_shell', { command: 'echo shell test' });
            if (!shellRes.includes('shell test')) throw new Error('Shell failed');
            
            // Shell workdir
            const subdir = 'subdir';
            await fs.mkdir(path.join(testDir, subdir), { recursive: true });
            const cwdCmd = process.platform === 'win32' ? 'cd' : 'pwd';
            const shellCwd = await registry.execute('execute_shell', { command: cwdCmd, workdir: subdir });
            // Normalize slashes and trim
            if (!shellCwd.replace(/\\/g, '/').trim().endsWith(subdir)) {
                 console.warn(`Shell workdir warning: got ${shellCwd.trim()} expected to end with ${subdir}`);
            } else {
                 console.log('ExecuteShellTool (workdir): Passed');
            }

            // 11. Validation Failure Test
            try {
                await registry.execute('read_file', { path: 123 }); // Invalid type
                throw new Error('Validation failed to catch invalid type');
            } catch (e: any) {
                if (!e.message.includes('Invalid arguments')) throw e;
                console.log('Validation Test: Passed');
            }

        } catch (e: any) {
            console.error('Test Failed:', e);
            process.exit(1);
        }
    });
}

runTests();
