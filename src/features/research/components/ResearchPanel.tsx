import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import ClipboardCopy from "lucide-react/dist/esm/icons/clipboard-copy";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import { PanelShell } from "@/features/layout/components/PanelShell";
import type { ResearchApiConfig, ResearchRun } from "@/types";
import { pushErrorToast } from "@/services/toasts";
import { formatRelativeTimeShort } from "@/utils/time";
import { ResearchDeliveryPromptCard } from "./ResearchDeliveryPromptCard";
import {
  buildResearchHttpExample,
  buildResearchRoundLabel,
} from "../utils/researchMessage";

type ResearchPanelProps = {
  filePanelMode: "git" | "files" | "prompts" | "research";
  onFilePanelModeChange: (mode: "git" | "files" | "prompts" | "research") => void;
  runs: ResearchRun[];
  selectedRun: ResearchRun | null;
  apiConfig: ResearchApiConfig | null;
  deliveryPrompt: string;
  showDeliveryPrompt?: boolean;
  onSelectRun: (runId: string) => void;
  onDeliveryPromptChange: (value: string) => void;
  onRetryDelivery: (runId: string) => void | Promise<void>;
  onDismissRun: (runId: string) => void | Promise<void>;
  onOpenThread: (run: ResearchRun) => void;
};

function copyText(value: string, label: string) {
  return navigator.clipboard.writeText(value).catch((error) => {
    pushErrorToast({
      title: `${label} copy failed`,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

function renderMetricValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

export function ResearchPanel({
  filePanelMode,
  onFilePanelModeChange,
  runs,
  selectedRun,
  apiConfig,
  deliveryPrompt,
  showDeliveryPrompt = true,
  onSelectRun,
  onDeliveryPromptChange,
  onRetryDelivery,
  onDismissRun,
  onOpenThread,
}: ResearchPanelProps) {
  const httpExample = buildResearchHttpExample(apiConfig, selectedRun);
  const resultFiles = selectedRun
    ? selectedRun.resultPaths.length > 0
      ? selectedRun.resultPaths
      : selectedRun.primaryResultPath
        ? [selectedRun.primaryResultPath]
        : []
    : [];
  const deliveryPromptSection = showDeliveryPrompt ? (
    <ResearchDeliveryPromptCard
      value={deliveryPrompt}
      onChange={onDeliveryPromptChange}
    />
  ) : null;

  return (
    <PanelShell
      filePanelMode={filePanelMode}
      onFilePanelModeChange={onFilePanelModeChange}
      className="research-panel-shell"
      headerRight={
        <div className="research-panel-header-right">
          <span className="research-panel-count">{runs.length} runs</span>
        </div>
      }
    >
      <div className="research-panel">
        {!selectedRun ? (
          <>
            {deliveryPromptSection}
            <div className="research-panel-empty">
              <FlaskConical aria-hidden />
              <h3>Research Runs</h3>
              <p>
                Select a run from the sidebar, or create one with{" "}
                <code>/research start &lt;title&gt;</code>. External scripts can also
                create and update runs through the local API below.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="research-panel-hero">
              <div>
                <div className="research-panel-kicker">Research run</div>
                <h3 title={selectedRun.title}>{selectedRun.title}</h3>
                <div className="research-panel-hero-meta">
                  {buildResearchRoundLabel(selectedRun) ? (
                    <span>{buildResearchRoundLabel(selectedRun)}</span>
                  ) : null}
                  <span>{selectedRun.status}</span>
                  <span>{selectedRun.deliveryStatus}</span>
                  <span>{formatRelativeTimeShort(selectedRun.updatedAt)}</span>
                </div>
              </div>
              <div className="research-panel-hero-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void copyText(selectedRun.id, "Run ID");
                  }}
                >
                  <ClipboardCopy size={14} aria-hidden />
                  Copy runId
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onOpenThread(selectedRun)}
                >
                  <ExternalLink size={14} aria-hidden />
                  Open thread
                </button>
                {selectedRun.status === "completed" &&
                selectedRun.deliveryStatus === "failed" ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void onRetryDelivery(selectedRun.id);
                    }}
                  >
                    <RefreshCw size={14} aria-hidden />
                    Retry delivery
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost research-panel-delete-action"
                  onClick={() => {
                    void onDismissRun(selectedRun.id);
                  }}
                >
                  <X size={14} aria-hidden />
                  Delete run
                </button>
              </div>
            </div>

            <div className="research-panel-grid">
              <div className="research-panel-card">
                <div className="research-panel-card-label">Stage</div>
                <div className="research-panel-card-value">{selectedRun.stageLabel}</div>
                <div className="research-panel-progress">
                  <div
                    className="research-panel-progress-bar"
                    style={{ width: `${Math.max(0, Math.min(100, selectedRun.progressPct))}%` }}
                  />
                </div>
                <div className="research-panel-card-muted">{selectedRun.latestMessage}</div>
              </div>

              <div className="research-panel-card">
                <div className="research-panel-card-label">Delivery</div>
                <div className="research-panel-card-value">{selectedRun.deliveryStatus}</div>
                <div className="research-panel-card-muted">
                  {selectedRun.deliveryError?.trim() || "Bound to the original thread only."}
                </div>
              </div>

              <div className="research-panel-card">
                <div className="research-panel-card-label">Bound thread</div>
                <div className="research-panel-card-value">{selectedRun.boundThreadId}</div>
                <div className="research-panel-card-muted">{selectedRun.workspaceId}</div>
              </div>
            </div>

            <div className="research-panel-section">
              <div className="research-panel-section-header">
                <h4>Summary</h4>
                {selectedRun.deliveryStatus === "sent" ? (
                  <span className="research-panel-sent-badge">
                    <CheckCircle2 size={14} aria-hidden />
                    Sent
                  </span>
                ) : null}
              </div>
              <p className="research-panel-summary">
                {selectedRun.resultSummary?.trim() || "No summary has been posted yet."}
              </p>
            </div>

            {deliveryPromptSection}

            <div className="research-panel-section">
              <div className="research-panel-section-header">
                <h4>Metrics</h4>
              </div>
              {Object.entries(selectedRun.metrics ?? {}).length === 0 ? (
                <p className="research-panel-empty-copy">No metrics reported yet.</p>
              ) : (
                <div className="research-metrics-list">
                  {Object.entries(selectedRun.metrics ?? {}).map(([key, value]) => {
                    const renderedValue = renderMetricValue(value);
                    return (
                      <div key={key} className="research-metric-row">
                        <span className="research-metric-key" title={key}>
                          {key}
                        </span>
                        <span className="research-metric-value" title={renderedValue}>
                          {renderedValue}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="research-panel-section">
              <div className="research-panel-section-header">
                <h4>Result files</h4>
              </div>
              {resultFiles.length === 0 ? (
                <p className="research-panel-empty-copy">No result files reported yet.</p>
              ) : (
                <div className="research-path-list">
                  {resultFiles.map((path) => (
                    <code key={path} className="research-path-pill" title={path}>
                      {path}
                    </code>
                  ))}
                </div>
              )}
            </div>

            <div className="research-panel-section">
              <div className="research-panel-section-header">
                <h4>Recent logs</h4>
              </div>
              <div className="research-log-list">
                {(selectedRun.logs ?? []).slice().reverse().map((entry) => (
                  <div key={entry.id} className="research-log-row">
                    <div className="research-log-row-meta">
                      <span>{entry.stageLabel}</span>
                      <span>{entry.progressPct}%</span>
                      <span>{formatRelativeTimeShort(entry.at)}</span>
                    </div>
                    <div className="research-log-row-message">{entry.message}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="research-panel-section">
              <div className="research-panel-section-header">
                <h4>Local API</h4>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void copyText(httpExample, "HTTP example");
                  }}
                >
                  <ClipboardCopy size={14} aria-hidden />
                  Copy example
                </button>
              </div>
              <pre className="research-http-example">
                <code>{httpExample}</code>
              </pre>
            </div>

            {runs.length > 1 ? (
              <div className="research-panel-section">
                <div className="research-panel-section-header">
                  <h4>Other runs</h4>
                </div>
                <div className="research-inline-list">
                  {runs
                    .filter((run) => run.id !== selectedRun.id)
                    .slice(0, 8)
                    .map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        className="research-inline-run"
                        onClick={() => onSelectRun(run.id)}
                      >
                        <span>{run.title}</span>
                        <span>{buildResearchRoundLabel(run) ?? run.status}</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PanelShell>
  );
}
