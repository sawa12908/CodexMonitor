import { describe, expect, it } from "vitest";
import type { ResearchRun } from "@/types";
import { buildResearchAnalysisMessage } from "./researchMessage";

function createRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "run-1",
    workspaceId: "workspace-1",
    boundThreadId: "thread-1",
    title: "ETF 阈值扫描",
    roundNumber: 9,
    status: "completed",
    progressPct: 100,
    stageLabel: "completed",
    latestMessage: "done",
    metrics: {},
    primaryResultPath: null,
    resultPaths: [],
    resultSummary: null,
    resultPreview: null,
    deliveryStatus: "idle",
    deliveryError: null,
    createdAt: 0,
    updatedAt: 0,
    completedAt: 0,
    dismissed: false,
    logs: [],
    ...overrides,
  };
}

describe("buildResearchAnalysisMessage", () => {
  it("uses the parent directory when primaryResultPath points to a file", () => {
    const message = buildResearchAnalysisMessage(
      createRun({
        primaryResultPath:
          "F:\\AStockQuantStarter_heavy\\qlib_lab\\outputs\\ml_runs\\etf\\round9\\evaluation_summary.csv",
      }),
    );

    expect(message).toContain(
      "主要产物路径：F:\\AStockQuantStarter_heavy\\qlib_lab\\outputs\\ml_runs\\etf\\round9。",
    );
  });

  it("keeps the path unchanged when it is already a directory", () => {
    const message = buildResearchAnalysisMessage(
      createRun({
        primaryResultPath:
          "F:\\AStockQuantStarter_heavy\\qlib_lab\\outputs\\ml_runs\\etf\\etf_lightgbm_bucket_portfolio_round9_route_defense_rebuild_v1_20260320",
      }),
    );

    expect(message).toContain(
      "主要产物路径：F:\\AStockQuantStarter_heavy\\qlib_lab\\outputs\\ml_runs\\etf\\etf_lightgbm_bucket_portfolio_round9_route_defense_rebuild_v1_20260320。",
    );
  });

  it("falls back to resultPaths when primaryResultPath is empty", () => {
    const message = buildResearchAnalysisMessage(
      createRun({
        primaryResultPath: " ",
        resultPaths: [
          "F:\\AStockQuantStarter_heavy\\qlib_lab\\outputs\\ml_runs\\etf\\round9\\predictions.csv",
        ],
      }),
    );

    expect(message).toContain(
      "主要产物路径：F:\\AStockQuantStarter_heavy\\qlib_lab\\outputs\\ml_runs\\etf\\round9。",
    );
  });
});
