import { useEffect, useState } from "react";

const SIDEBAR_COLLAPSED_KEY = "codexmonitor.sidebarCollapsed";
const RIGHT_PANEL_COLLAPSED_KEY = "codexmonitor.rightPanelCollapsed";
const RESEARCH_PANEL_COLLAPSED_KEY = "codexmonitor.researchPanelCollapsed";

type UseSidebarTogglesOptions = {
  isCompact: boolean;
};

function readStoredBool(key: string) {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(key) === "true";
}

export function useSidebarToggles({ isCompact }: UseSidebarTogglesOptions) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredBool(SIDEBAR_COLLAPSED_KEY),
  );
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() =>
    readStoredBool(RIGHT_PANEL_COLLAPSED_KEY),
  );
  const [researchPanelCollapsed, setResearchPanelCollapsed] = useState(() =>
    readStoredBool(RESEARCH_PANEL_COLLAPSED_KEY),
  );

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_KEY,
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(
      RIGHT_PANEL_COLLAPSED_KEY,
      String(rightPanelCollapsed),
    );
  }, [rightPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(
      RESEARCH_PANEL_COLLAPSED_KEY,
      String(researchPanelCollapsed),
    );
  }, [researchPanelCollapsed]);

  const collapseSidebar = () => {
    if (!isCompact) {
      setSidebarCollapsed(true);
    }
  };

  const expandSidebar = () => {
    if (!isCompact) {
      setSidebarCollapsed(false);
    }
  };

  const collapseRightPanel = () => {
    if (!isCompact) {
      setRightPanelCollapsed(true);
    }
  };

  const expandRightPanel = () => {
    if (!isCompact) {
      setRightPanelCollapsed(false);
    }
  };

  const collapseResearchPanel = () => {
    if (!isCompact) {
      setResearchPanelCollapsed(true);
    }
  };

  const expandResearchPanel = () => {
    if (!isCompact) {
      setResearchPanelCollapsed(false);
    }
  };

  return {
    sidebarCollapsed,
    rightPanelCollapsed,
    researchPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    collapseResearchPanel,
    expandResearchPanel,
  };
}
