import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import type { ResearchRun } from "@/types";
import { formatRelativeTimeShort } from "@/utils/time";
import { buildResearchRoundLabel } from "../utils/researchMessage";

type ResearchSidebarSectionProps = {
  runs: ResearchRun[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
};

function renderStatusText(run: ResearchRun) {
  if (run.status === "running") {
    return `${run.progressPct}%`;
  }
  if (run.status === "completed") {
    return run.deliveryStatus === "sent" ? "sent" : run.deliveryStatus;
  }
  return run.status;
}

export function ResearchSidebarSection({
  runs,
  selectedRunId,
  onSelectRun,
}: ResearchSidebarSectionProps) {
  const activeRuns = runs.filter(
    (run) => run.status === "created" || run.status === "running",
  );
  const recentRuns = runs
    .filter((run) => run.status === "completed" || run.status === "failed")
    .slice(0, 6);
  const runningCount = activeRuns.length;
  const completedCount = recentRuns.length;

  const renderRunButton = (run: ResearchRun) => {
    const roundLabel = buildResearchRoundLabel(run);
    const updatedLabel = formatRelativeTimeShort(run.updatedAt);
    const isActive = run.id === selectedRunId;
    return (
      <button
        key={run.id}
        type="button"
        className={`research-sidebar-item${isActive ? " is-active" : ""}`}
        onClick={() => onSelectRun(run.id)}
      >
        <div className="research-sidebar-item-header">
          <span className={`research-run-dot is-${run.status}`} aria-hidden />
          <span className="research-sidebar-item-title">{run.title}</span>
        </div>
        <div className="research-sidebar-item-meta">
          {roundLabel ? <span>{roundLabel}</span> : null}
          <span>{renderStatusText(run)}</span>
          {updatedLabel ? <span>{updatedLabel}</span> : null}
        </div>
        <div className="research-sidebar-item-message">{run.latestMessage}</div>
      </button>
    );
  };

  return (
    <section className="research-sidebar-section">
      <div className="workspace-group-header">
        <div className="workspace-group-label research-sidebar-label">
          <FlaskConical aria-hidden />
          <span>Research</span>
        </div>
        <div className="research-sidebar-counts">
          <span>{runningCount} active</span>
          <span>{completedCount} recent</span>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="research-sidebar-empty">
          No research runs yet. Start one with <code>/research start &lt;title&gt;</code>.
        </div>
      ) : (
        <div className="research-sidebar-list">
          {activeRuns.length > 0 ? (
            <>
              <div className="research-sidebar-subhead">Active</div>
              {activeRuns.map(renderRunButton)}
            </>
          ) : null}
          {recentRuns.length > 0 ? (
            <>
              <div className="research-sidebar-subhead">Recent</div>
              {recentRuns.map(renderRunButton)}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
