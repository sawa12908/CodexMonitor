import { useEffect, useRef } from "react";
import type { WorkspaceInfo } from "../../../types";

const INITIAL_THREAD_LIST_MAX_PAGES = 6;

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  updateWorkspaceSettings: (
    workspaceId: string,
    settings: Partial<WorkspaceInfo["settings"]>,
  ) => Promise<WorkspaceInfo>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: { preserveState?: boolean; maxPages?: number },
  ) => Promise<void>;
};

export function useWorkspaceRestore({
  workspaces,
  hasLoaded,
  connectWorkspace,
  updateWorkspaceSettings,
  listThreadsForWorkspaces,
}: WorkspaceRestoreOptions) {
  const restoredWorkspaces = useRef(new Set<string>());
  const singletonWorkspaceHandled = useRef(false);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    const singletonWorkspace = workspaces.length === 1 ? workspaces[0] : null;
    if (singletonWorkspace && !singletonWorkspaceHandled.current) {
      singletonWorkspaceHandled.current = true;
      if (singletonWorkspace.settings.sidebarCollapsed) {
        void updateWorkspaceSettings(singletonWorkspace.id, {
          sidebarCollapsed: false,
        });
      }
    }
    const pending = workspaces.filter(
      (workspace) => !restoredWorkspaces.current.has(workspace.id),
    );
    if (pending.length === 0) {
      return;
    }
    pending.forEach((workspace) => {
      restoredWorkspaces.current.add(workspace.id);
    });
    void (async () => {
      const connectedTargets: WorkspaceInfo[] = [];
      for (const workspace of pending) {
        const wasConnected = workspace.connected;
        try {
          if (!wasConnected) {
            await connectWorkspace(workspace);
          }
          connectedTargets.push({ ...workspace, connected: true });
        } catch {
          // Silent: connection errors show in debug panel.
        }
      }
      if (connectedTargets.length > 0) {
        await listThreadsForWorkspaces(connectedTargets, {
          maxPages: INITIAL_THREAD_LIST_MAX_PAGES,
        });
      }
    })();
  }, [connectWorkspace, hasLoaded, listThreadsForWorkspaces, updateWorkspaceSettings, workspaces]);
}
