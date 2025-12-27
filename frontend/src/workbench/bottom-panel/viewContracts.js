/**
 * View contract (minimal VS Code-ish shape)
 * - `id`: stable id
 * - `label`: tab label
 * - `keepAlive`: keep mounted when inactive (Terminal)
 * - `Component`: React component for body
 * - `Toolbar`: optional React component for toolbar
 */

export const ViewIds = {
  problems: 'problems',
  output: 'output',
  debugConsole: 'debugConsole',
  terminal: 'terminal',
  ports: 'ports',
  gitlens: 'gitlens',
};

