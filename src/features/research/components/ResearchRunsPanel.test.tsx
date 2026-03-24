// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResearchRun } from "@/types";
import { ResearchRunsPanel } from "./ResearchRunsPanel";

function createRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "run-1",
    workspaceId: "workspace-1",
    boundThreadId: "thread-1",
    title: "ETF ML evaluate etf_lightgbm_bucket",
    roundNumber: 13,
    status: "running",
    progressPct: 42,
    stageLabel: "Running Backtests",
    latestMessage: "Running backtest variant.",
    metrics: {},
    primaryResultPath: null,
    resultPaths: [],
    resultSummary: null,
    resultPreview: null,
    deliveryStatus: "queued",
    deliveryError: null,
    createdAt: 0,
    updatedAt: Date.now(),
    completedAt: null,
    dismissed: false,
    logs: [],
    ...overrides,
  };
}

describe("ResearchRunsPanel", () => {
  it("keeps the workspace delivery prompt visible even without runs", () => {
    const onDeliveryPromptChange = vi.fn();

    render(
      <ResearchRunsPanel
        runs={[]}
        deliveryPrompt="Please summarize the round and start the next one."
        selectedRunId={null}
        onDeliveryPromptChange={onDeliveryPromptChange}
        onSelectRun={vi.fn()}
      />,
    );

    expect(screen.getByText("Auto follow-up")).toBeTruthy();
    expect(
      screen.getByDisplayValue("Please summarize the round and start the next one."),
    ).toBeTruthy();
    expect(screen.getByText(/No research runs yet/i)).toBeTruthy();
  });

  it("updates the shared delivery prompt from the left research panel", () => {
    const onDeliveryPromptChange = vi.fn();

    const view = render(
      <ResearchRunsPanel
        runs={[createRun()]}
        deliveryPrompt=""
        selectedRunId="run-1"
        onDeliveryPromptChange={onDeliveryPromptChange}
        onSelectRun={vi.fn()}
      />,
    );

    fireEvent.change(view.container.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "Continue with round14 using the best variant." },
    });

    expect(onDeliveryPromptChange).toHaveBeenCalledWith(
      "Continue with round14 using the best variant.",
    );
    expect(screen.getByText("ETF ML evaluate etf_lightgbm_bucket")).toBeTruthy();
  });
});
