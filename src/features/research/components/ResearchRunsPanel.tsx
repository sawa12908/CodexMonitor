import type { ResearchRun } from "@/types";
import { ResearchDeliveryPromptCard } from "./ResearchDeliveryPromptCard";
import { ResearchSidebarSection } from "./ResearchSidebarSection";

type ResearchRunsPanelProps = {
  runs: ResearchRun[];
  deliveryPrompt: string;
  selectedRunId: string | null;
  onDeliveryPromptChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
};

export function ResearchRunsPanel({
  runs,
  deliveryPrompt,
  selectedRunId,
  onDeliveryPromptChange,
  onSelectRun,
}: ResearchRunsPanelProps) {
  return (
    <aside className="left-research-panel" aria-label="Research progress panel">
      <div className="left-research-panel-drag-strip" />
      <div className="left-research-panel-body">
        <ResearchDeliveryPromptCard
          className="left-research-delivery-prompt"
          value={deliveryPrompt}
          onChange={onDeliveryPromptChange}
        />
        <ResearchSidebarSection
          runs={runs}
          selectedRunId={selectedRunId}
          onSelectRun={onSelectRun}
        />
      </div>
    </aside>
  );
}
