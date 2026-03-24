import type { ResearchApiConfig, ResearchRun } from "@/types";

export function buildResearchRoundLabel(
  run: Pick<ResearchRun, "roundNumber">,
): string | null {
  if (typeof run.roundNumber !== "number") {
    return null;
  }
  return `Round ${run.roundNumber}`;
}

function trimTrailingSeparators(path: string): string {
  if (/^[A-Za-z]:[\\/]?$/.test(path) || path === "/" || path === "\\") {
    return path;
  }
  return path.replace(/[\\/]+$/, "");
}

function toArtifactDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimTrailingSeparators(trimmed);
  const lastSeparatorIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  const leafName =
    lastSeparatorIndex >= 0 ? normalized.slice(lastSeparatorIndex + 1) : normalized;
  const looksLikeFile = /\.[A-Za-z0-9]{1,10}$/.test(leafName);

  if (!looksLikeFile || lastSeparatorIndex < 0) {
    return normalized;
  }
  return normalized.slice(0, lastSeparatorIndex) || normalized;
}

export function buildResearchAnalysisMessage(run: ResearchRun): string {
  const roundText =
    typeof run.roundNumber === "number"
      ? `\u7b2c${run.roundNumber}\u8f6e`
      : "\u5f53\u524d\u8f6e";
  const artifactPath =
    [run.primaryResultPath, ...run.resultPaths]
      .map((path) => toArtifactDirectoryPath(path ?? ""))
      .find((path) => path.length > 0) ?? "\u672a\u63d0\u4f9b";

  return `\u300a${run.title}\u300b${roundText}\u5df2\u5b8c\u6210\uff0c\u4e3b\u8981\u4ea7\u7269\u8def\u5f84\uff1a${artifactPath}\u3002`;
}

export function buildResearchHttpExample(
  config: ResearchApiConfig | null,
  run: ResearchRun | null,
): string {
  if (!config?.baseUrl) {
    return "Research API unavailable.";
  }

  const authToken = config.authToken.trim() || "<token>";
  const createRunLines = run
    ? [
        "$createBody = @{",
        '  title = "ETF threshold scan"',
        `  workspaceId = "${run.workspaceId}"`,
        `  threadId = "${run.boundThreadId}"`,
        "} | ConvertTo-Json",
      ]
    : [
        "$createBody = @{",
        '  title = "ETF threshold scan"',
        '  workspacePath = "C:\\AStockQuantStarter"',
        "} | ConvertTo-Json",
      ];

  return [
    "$headers = @{",
    `  Authorization = "Bearer ${authToken}"`,
    '  "Content-Type" = "application/json"',
    "}",
    "",
    ...createRunLines,
    "",
    `$created = Invoke-RestMethod -Method Post -Uri "${config.baseUrl}/v1/research-runs" -Headers $headers -Body $createBody`,
    "$runId = $created.run.id",
    "",
    "$progressBody = @{",
    '  stage = "collecting factors"',
    "  progressPct = 42",
    '  message = "Universe scan complete, factor merge running."',
    '  primaryResultPath = "C:\\results\\strategy_round_12"',
    "} | ConvertTo-Json",
    "",
    `Invoke-RestMethod -Method Post -Uri "${config.baseUrl}/v1/research-runs/$runId/progress" -Headers $headers -Body $progressBody`,
  ].join("\n");
}
