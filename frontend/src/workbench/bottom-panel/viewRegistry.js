import { ViewIds } from './viewContracts';
import ProblemsView from '../views/ProblemsView/ProblemsView';
import ProblemsToolbar from '../views/ProblemsView/ProblemsToolbar';
import OutputView from '../views/OutputView/OutputView';
import OutputToolbar from '../views/OutputView/OutputToolbar';
import DebugConsoleView from '../views/DebugConsoleView/DebugConsoleView';
import DebugConsoleToolbar from '../views/DebugConsoleView/DebugConsoleToolbar';
import TerminalView from '../views/TerminalView/TerminalView';
import TerminalToolbar from '../views/TerminalView/TerminalToolbar';
import PortsView from '../views/PortsView/PortsView';
import PortsToolbar from '../views/PortsView/PortsToolbar';
import GitLensView from '../views/GitLensView/GitLensView';
import GitLensToolbar from '../views/GitLensView/GitLensToolbar';

export const viewRegistry = {
  list() {
    return [
      { id: ViewIds.problems, label: '问题', Component: ProblemsView, Toolbar: ProblemsToolbar },
      { id: ViewIds.output, label: '输出', Component: OutputView, Toolbar: OutputToolbar },
      { id: ViewIds.debugConsole, label: '调试控制台', Component: DebugConsoleView, Toolbar: DebugConsoleToolbar },
      { id: ViewIds.terminal, label: '终端', Component: TerminalView, Toolbar: TerminalToolbar, keepAlive: true },
      { id: ViewIds.ports, label: '端口', Component: PortsView, Toolbar: PortsToolbar },
      { id: ViewIds.gitlens, label: 'GITLENS', Component: GitLensView, Toolbar: GitLensToolbar },
    ];
  },
  byId(id) {
    return this.list().find((v) => v.id === id) || null;
  },
};
