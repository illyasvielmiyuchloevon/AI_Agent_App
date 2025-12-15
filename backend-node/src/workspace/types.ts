export interface WorkspaceFoldersEntry {
  path: string;
  name?: string;
}

export interface WorkspaceSettings {
  [key: string]: any;
}

export interface WorkspaceState {
  [key: string]: any;
}

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  folders: WorkspaceFoldersEntry[];
  settings: WorkspaceSettings;
  state: WorkspaceState;
  openedAt: string;
  closedAt?: string | null;
  workspaceFile?: string | null;
}
