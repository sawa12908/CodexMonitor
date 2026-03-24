// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useWorkspaceRestore } from "./useWorkspaceRestore";

const collapsedWorkspace: WorkspaceInfo = {
  id: "ws-1",
  name: "workspace-one",
  path: "/tmp/ws-1",
  connected: true,
  kind: "main",
  parentId: null,
  worktree: null,
  settings: { sidebarCollapsed: true },
};

const expandedWorkspace: WorkspaceInfo = {
  ...collapsedWorkspace,
  id: "ws-2",
  name: "workspace-two",
  path: "/tmp/ws-2",
  settings: { sidebarCollapsed: false },
};

describe("useWorkspaceRestore", () => {
  it("auto-expands a single collapsed workspace on restore", async () => {
    const connectWorkspace = vi.fn().mockResolvedValue(undefined);
    const updateWorkspaceSettings = vi.fn().mockResolvedValue({
      ...collapsedWorkspace,
      settings: { sidebarCollapsed: false },
    });
    const listThreadsForWorkspaces = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceRestore({
        workspaces: [collapsedWorkspace],
        hasLoaded: true,
        connectWorkspace,
        updateWorkspaceSettings,
        listThreadsForWorkspaces,
      }),
    );

    await waitFor(() =>
      expect(updateWorkspaceSettings).toHaveBeenCalledWith(collapsedWorkspace.id, {
        sidebarCollapsed: false,
      }),
    );
    await waitFor(() =>
      expect(listThreadsForWorkspaces).toHaveBeenCalledWith(
        [{ ...collapsedWorkspace, connected: true }],
        { maxPages: 6 },
      ),
    );
  });

  it("does not auto-expand when more than one workspace is restored", async () => {
    const connectWorkspace = vi.fn().mockResolvedValue(undefined);
    const updateWorkspaceSettings = vi.fn().mockResolvedValue(expandedWorkspace);
    const listThreadsForWorkspaces = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceRestore({
        workspaces: [collapsedWorkspace, expandedWorkspace],
        hasLoaded: true,
        connectWorkspace,
        updateWorkspaceSettings,
        listThreadsForWorkspaces,
      }),
    );

    await waitFor(() =>
      expect(listThreadsForWorkspaces).toHaveBeenCalledWith(
        [
          { ...collapsedWorkspace, connected: true },
          { ...expandedWorkspace, connected: true },
        ],
        { maxPages: 6 },
      ),
    );
    expect(updateWorkspaceSettings).not.toHaveBeenCalled();
  });
});
