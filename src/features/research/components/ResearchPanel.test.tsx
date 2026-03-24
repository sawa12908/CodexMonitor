// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResearchRun } from "@/types";
import { ResearchPanel } from "./ResearchPanel";

function createRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "run-1",
    workspaceId: "workspace-1",
    boundThreadId: "thread-1",
    title: "ETF ML evaluate etf_lightgbm_bucket",
    roundNumber: 13,
    status: "completed",
    progressPct: 100,
    stageLabel: "Completed",
    latestMessage: "Research run completed.",
    metrics: {},
    primaryResultPath: null,
    resultPaths: [],
    resultSummary: "Done",
    resultPreview: null,
    deliveryStatus: "sent",
    deliveryError: null,
    createdAt: 0,
    updatedAt: Date.now(),
    completedAt: Date.now(),
    dismissed: false,
    logs: [],
    ...overrides,
  };
}

function renderPanel(showDeliveryPrompt: boolean) {
  return render(
    <ResearchPanel
      filePanelMode="research"
      onFilePanelModeChange={vi.fn()}
      runs={[createRun()]}
      selectedRun={createRun()}
      apiConfig={{ baseUrl: null, authToken: "" }}
      deliveryPrompt="Persist me"
      showDeliveryPrompt={showDeliveryPrompt}
      onSelectRun={vi.fn()}
      onDeliveryPromptChange={vi.fn()}
      onRetryDelivery={vi.fn()}
      onDismissRun={vi.fn()}
      onOpenThread={vi.fn()}
    />,
  );
}

describe("ResearchPanel", () => {
  it("hides the shared delivery prompt in the right panel when requested", () => {
    renderPanel(false);

    expect(screen.queryByText("Auto follow-up")).toBeNull();
    expect(screen.queryByDisplayValue("Persist me")).toBeNull();
  });

  it("can still render the delivery prompt when no detached sidebar is available", () => {
    renderPanel(true);

    expect(screen.getByText("Auto follow-up")).toBeTruthy();
    expect(screen.getByDisplayValue("Persist me")).toBeTruthy();
  });
});
