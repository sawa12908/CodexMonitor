// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@/types";
import { useResearchRuns } from "./useResearchRuns";

const {
  subscribeResearchRunEventsMock,
  getResearchApiConfigMock,
  listResearchRunsMock,
} = vi.hoisted(() => ({
  subscribeResearchRunEventsMock: vi.fn(() => () => {}),
  getResearchApiConfigMock: vi.fn(),
  listResearchRunsMock: vi.fn(),
}));

vi.mock("@/services/events", () => ({
  subscribeResearchRunEvents: subscribeResearchRunEventsMock,
}));

vi.mock("@/services/tauri", () => ({
  createResearchRun: vi.fn(),
  dismissResearchRun: vi.fn(),
  getResearchApiConfig: getResearchApiConfigMock,
  listResearchRuns: listResearchRunsMock,
  retryResearchDelivery: vi.fn(),
  setResearchRunDeliveryStatus: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "AStockQuantStarter",
  path: "C:/AStockQuantStarter",
  connected: true,
  kind: "main",
  parentId: null,
  worktree: null,
  settings: {
    sidebarCollapsed: false,
  },
};

function createOptions(activeWorkspace: WorkspaceInfo | null = workspace) {
  return {
    activeWorkspace,
    activeThreadId: "thread-1",
    workspacesById: activeWorkspace
      ? new Map([[activeWorkspace.id, activeWorkspace]])
      : new Map<string, WorkspaceInfo>(),
    threadStatusById: {},
    connectWorkspace: vi.fn().mockResolvedValue(undefined),
    sendUserMessageToThread: vi.fn().mockResolvedValue({ status: "sent" }),
    onShowResearchPanel: vi.fn(),
  };
}

describe("useResearchRuns", () => {
  beforeEach(() => {
    window.localStorage.clear();
    subscribeResearchRunEventsMock.mockClear();
    getResearchApiConfigMock.mockReset();
    listResearchRunsMock.mockReset();
    getResearchApiConfigMock.mockResolvedValue({
      baseUrl: null,
      authToken: "",
    });
    listResearchRunsMock.mockResolvedValue([]);
  });

  it("restores a stored delivery prompt for the active workspace", async () => {
    window.localStorage.setItem(
      "codexmonitor.researchDeliveryPrompt.workspace-1",
      "Analyze the results and queue the next round.",
    );

    const { result } = renderHook(() => useResearchRuns(createOptions()));

    await waitFor(() => {
      expect(listResearchRunsMock).toHaveBeenCalledWith("workspace-1");
    });

    await waitFor(() => {
      expect(result.current.activeDeliveryPrompt).toBe(
        "Analyze the results and queue the next round.",
      );
    });
  });

  it("persists delivery prompt changes across remounts", async () => {
    const firstHook = renderHook(() => useResearchRuns(createOptions()));

    await waitFor(() => {
      expect(listResearchRunsMock).toHaveBeenCalledWith("workspace-1");
    });

    act(() => {
      firstHook.result.current.setDeliveryPrompt("Summarize this run and continue.");
    });

    expect(
      window.localStorage.getItem("codexmonitor.researchDeliveryPrompt.workspace-1"),
    ).toBe("Summarize this run and continue.");

    firstHook.unmount();

    const secondHook = renderHook(() => useResearchRuns(createOptions()));

    await waitFor(() => {
      expect(secondHook.result.current.activeDeliveryPrompt).toBe(
        "Summarize this run and continue.",
      );
    });
  });
});
