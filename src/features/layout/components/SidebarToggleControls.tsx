import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";

export type SidebarToggleProps = {
  isCompact: boolean;
  hasResearchPanel: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  researchPanelCollapsed: boolean;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCollapseRightPanel: () => void;
  onExpandRightPanel: () => void;
  onCollapseResearchPanel: () => void;
  onExpandResearchPanel: () => void;
};

export function SidebarCollapseButton({
  isCompact,
  sidebarCollapsed,
  onCollapseSidebar,
}: SidebarToggleProps) {
  if (isCompact || sidebarCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={onCollapseSidebar}
      data-tauri-drag-region="false"
      aria-label="Hide threads sidebar"
      title="Hide threads sidebar"
    >
      <PanelLeftClose size={14} aria-hidden />
    </button>
  );
}

export function RightPanelCollapseButton({
  isCompact,
  rightPanelCollapsed,
  onCollapseRightPanel,
}: SidebarToggleProps) {
  if (isCompact || rightPanelCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={onCollapseRightPanel}
      data-tauri-drag-region="false"
      aria-label="Hide git sidebar"
      title="Hide git sidebar"
    >
      <PanelRightClose size={14} aria-hidden />
    </button>
  );
}

export function RightPanelExpandButton({
  isCompact,
  rightPanelCollapsed,
  onExpandRightPanel,
}: SidebarToggleProps) {
  if (isCompact || !rightPanelCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={onExpandRightPanel}
      data-tauri-drag-region="false"
      aria-label="Show git sidebar"
      title="Show git sidebar"
    >
      <PanelRightOpen size={14} aria-hidden />
    </button>
  );
}

export function ResearchPanelCollapseButton({
  isCompact,
  hasResearchPanel,
  researchPanelCollapsed,
  onCollapseResearchPanel,
}: SidebarToggleProps) {
  if (isCompact || !hasResearchPanel || researchPanelCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={onCollapseResearchPanel}
      data-tauri-drag-region="false"
      aria-label="Hide research progress panel"
      title="Hide research progress panel"
    >
      <FlaskConical size={14} aria-hidden />
    </button>
  );
}

export function ResearchPanelExpandButton({
  isCompact,
  hasResearchPanel,
  researchPanelCollapsed,
  onExpandResearchPanel,
}: SidebarToggleProps) {
  if (isCompact || !hasResearchPanel || !researchPanelCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={onExpandResearchPanel}
      data-tauri-drag-region="false"
      aria-label="Show research progress panel"
      title="Show research progress panel"
    >
      <FlaskConical size={14} aria-hidden />
    </button>
  );
}

export function TitlebarExpandControls({
  isCompact,
  sidebarCollapsed,
  onExpandSidebar,
}: SidebarToggleProps) {
  if (isCompact || !sidebarCollapsed) {
    return null;
  }
  return (
    <div className="titlebar-controls">
      {sidebarCollapsed && (
        <div className="titlebar-toggle titlebar-toggle-left">
          <button
            type="button"
            className="ghost main-header-action"
            onClick={onExpandSidebar}
            data-tauri-drag-region="false"
            aria-label="Show threads sidebar"
            title="Show threads sidebar"
          >
            <PanelLeftOpen size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
