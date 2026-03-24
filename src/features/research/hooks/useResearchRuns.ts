import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeResearchRunEvents } from "@/services/events";
import {
  createResearchRun as createResearchRunService,
  dismissResearchRun as dismissResearchRunService,
  getResearchApiConfig,
  listResearchRuns,
  retryResearchDelivery as retryResearchDeliveryService,
  setResearchRunDeliveryStatus as setResearchRunDeliveryStatusService,
} from "@/services/tauri";
import { pushErrorToast } from "@/services/toasts";
import type {
  ResearchApiConfig,
  ResearchRun,
  SendMessageResult,
  WorkspaceInfo,
} from "@/types";
import { buildResearchAnalysisMessage } from "../utils/researchMessage";

const DELIVERY_PROMPT_STORAGE_PREFIX = "codexmonitor.researchDeliveryPrompt.";

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
};

type SendUserMessageToThread = (
  workspace: WorkspaceInfo,
  threadId: string,
  text: string,
  images?: string[],
  options?: { sendIntent?: "default" | "queue" | "steer" },
) => Promise<void | SendMessageResult>;

type UseResearchRunsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  workspacesById: Map<string, WorkspaceInfo>;
  threadStatusById: Record<string, ThreadStatusSnapshot>;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  sendUserMessageToThread: SendUserMessageToThread;
  onShowResearchPanel: () => void;
};

function sortRuns(left: ResearchRun, right: ResearchRun) {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getDeliveryPromptStorageKey(workspaceId: string) {
  return `${DELIVERY_PROMPT_STORAGE_PREFIX}${workspaceId}`;
}

function readStoredDeliveryPrompt(workspaceId: string) {
  if (typeof window === "undefined" || !workspaceId) {
    return "";
  }
  try {
    return window.localStorage.getItem(getDeliveryPromptStorageKey(workspaceId)) ?? "";
  } catch {
    return "";
  }
}

function writeStoredDeliveryPrompt(workspaceId: string, value: string) {
  if (typeof window === "undefined" || !workspaceId) {
    return;
  }
  try {
    if (value.trim().length === 0) {
      window.localStorage.removeItem(getDeliveryPromptStorageKey(workspaceId));
      return;
    }
    window.localStorage.setItem(getDeliveryPromptStorageKey(workspaceId), value);
  } catch {
    // Ignore storage failures and keep the in-memory value.
  }
}

export function useResearchRuns({
  activeWorkspace,
  activeThreadId,
  workspacesById,
  threadStatusById,
  connectWorkspace,
  sendUserMessageToThread,
  onShowResearchPanel,
}: UseResearchRunsOptions) {
  const [runsById, setRunsById] = useState<Record<string, ResearchRun>>({});
  const [selectedRunIdsByWorkspace, setSelectedRunIdsByWorkspace] = useState<
    Record<string, string | null>
  >({});
  const [deliveryPromptByWorkspace, setDeliveryPromptByWorkspace] = useState<
    Record<string, string>
  >({});
  const [apiConfig, setApiConfig] = useState<ResearchApiConfig | null>(null);
  const deliveryInFlightRef = useRef<Set<string>>(new Set());
  const loadedDeliveryPromptWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const activeWorkspaceId = activeWorkspace?.id ?? null;

  const replaceWorkspaceRuns = useCallback((workspaceId: string, nextRuns: ResearchRun[]) => {
    setRunsById((previous) => {
      const next = { ...previous };
      Object.values(next).forEach((run) => {
        if (run.workspaceId === workspaceId) {
          delete next[run.id];
        }
      });
      nextRuns.forEach((run) => {
        next[run.id] = run;
      });
      return next;
    });
  }, []);

  const upsertRun = useCallback((run: ResearchRun) => {
    setRunsById((previous) => ({
      ...previous,
      [run.id]: run,
    }));
  }, []);

  const setSelectedRunIdForWorkspace = useCallback(
    (workspaceId: string, runId: string | null) => {
      setSelectedRunIdsByWorkspace((previous) => {
        if (!workspaceId) {
          return previous;
        }
        if ((previous[workspaceId] ?? null) === runId) {
          return previous;
        }
        return {
          ...previous,
          [workspaceId]: runId,
        };
      });
    },
    [],
  );

  useEffect(() => {
    getResearchApiConfig()
      .then((config) => {
        setApiConfig(config);
      })
      .catch((error) => {
        console.warn("[research] failed to load api config", error);
      });
  }, []);

  useEffect(() => {
    if (!activeWorkspace) {
      return;
    }
    listResearchRuns(activeWorkspace.id)
      .then((runs) => {
        replaceWorkspaceRuns(activeWorkspace.id, runs);
      })
      .catch((error) => {
        pushErrorToast({
          title: "Research runs unavailable",
          message: asErrorMessage(error),
        });
      });
  }, [activeWorkspace, replaceWorkspaceRuns]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    const storedPrompt = readStoredDeliveryPrompt(activeWorkspaceId);
    loadedDeliveryPromptWorkspaceIdsRef.current.add(activeWorkspaceId);
    setDeliveryPromptByWorkspace((previous) => {
      if ((previous[activeWorkspaceId] ?? "") === storedPrompt) {
        return previous;
      }
      return {
        ...previous,
        [activeWorkspaceId]: storedPrompt,
      };
    });
  }, [activeWorkspaceId]);

  useEffect(() => {
    return subscribeResearchRunEvents((run) => {
      upsertRun(run);
      if (!run.dismissed) {
        setSelectedRunIdsByWorkspace((previous) => {
          if (previous[run.workspaceId] ?? null) {
            return previous;
          }
          return {
            ...previous,
            [run.workspaceId]: run.id,
          };
        });
      }
    });
  }, [upsertRun]);

  const runs = useMemo(
    () => Object.values(runsById).filter((run) => !run.dismissed).sort(sortRuns),
    [runsById],
  );

  const activeWorkspaceRuns = useMemo(
    () =>
      activeWorkspace
        ? runs.filter((run) => run.workspaceId === activeWorkspace.id)
        : [],
    [activeWorkspace, runs],
  );

  const selectedRunId = useMemo(
    () => (activeWorkspaceId ? selectedRunIdsByWorkspace[activeWorkspaceId] ?? null : null),
    [activeWorkspaceId, selectedRunIdsByWorkspace],
  );

  const activeResearchRun = useMemo(
    () => {
      if (!activeWorkspaceId || !selectedRunId) {
        return null;
      }
      const run = runsById[selectedRunId] ?? null;
      return run && run.workspaceId === activeWorkspaceId ? run : null;
    },
    [activeWorkspaceId, runsById, selectedRunId],
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    if (activeResearchRun && !activeResearchRun.dismissed) {
      return;
    }
    const nextVisibleRun = activeWorkspaceRuns[0] ?? null;
    setSelectedRunIdForWorkspace(activeWorkspaceId, nextVisibleRun?.id ?? null);
  }, [activeResearchRun, activeWorkspaceId, activeWorkspaceRuns, setSelectedRunIdForWorkspace]);

  const selectResearchRun = useCallback(
    (runId: string) => {
      const workspaceId = runsById[runId]?.workspaceId ?? activeWorkspaceId;
      if (!workspaceId) {
        return;
      }
      setSelectedRunIdForWorkspace(workspaceId, runId);
      onShowResearchPanel();
    },
    [activeWorkspaceId, onShowResearchPanel, runsById, setSelectedRunIdForWorkspace],
  );

  const createResearchRun = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        pushErrorToast({
          title: "Research run unavailable",
          message: "Use /research start <title> to name the run.",
        });
        return null;
      }
      if (!activeWorkspace) {
        pushErrorToast({
          title: "Research run unavailable",
          message: "Select a workspace before starting a research run.",
        });
        return null;
      }
      if (!activeThreadId) {
        pushErrorToast({
          title: "Research run unavailable",
          message: "Open a thread in this workspace before starting a research run.",
        });
        return null;
      }
      const run = await createResearchRunService(activeWorkspace.id, activeThreadId, trimmed);
      upsertRun(run);
      setSelectedRunIdForWorkspace(run.workspaceId, run.id);
      onShowResearchPanel();
      return run;
    },
    [
      activeThreadId,
      activeWorkspace,
      onShowResearchPanel,
      setSelectedRunIdForWorkspace,
      upsertRun,
    ],
  );

  const retryResearchDelivery = useCallback(async (runId: string) => {
    const run = await retryResearchDeliveryService(runId);
    upsertRun(run);
    setSelectedRunIdForWorkspace(run.workspaceId, run.id);
    onShowResearchPanel();
    return run;
  }, [onShowResearchPanel, setSelectedRunIdForWorkspace, upsertRun]);

  const dismissResearchRun = useCallback(async (runId: string) => {
    const run = await dismissResearchRunService(runId);
    upsertRun(run);
    if ((selectedRunIdsByWorkspace[run.workspaceId] ?? null) === runId) {
      setSelectedRunIdForWorkspace(run.workspaceId, null);
    }
    return run;
  }, [selectedRunIdsByWorkspace, setSelectedRunIdForWorkspace, upsertRun]);

  const setDeliveryPrompt = useCallback((value: string) => {
    if (!activeWorkspaceId) {
      return;
    }
    writeStoredDeliveryPrompt(activeWorkspaceId, value);
    loadedDeliveryPromptWorkspaceIdsRef.current.add(activeWorkspaceId);
    setDeliveryPromptByWorkspace((previous) => {
      if ((previous[activeWorkspaceId] ?? "") === value) {
        return previous;
      }
      return {
        ...previous,
        [activeWorkspaceId]: value,
      };
    });
  }, [activeWorkspaceId]);

  useEffect(() => {
    runs.forEach((run) => {
      if (run.status !== "completed") {
        return;
      }
      if (
        run.deliveryStatus === "sent" ||
        run.deliveryStatus === "failed" ||
        run.deliveryStatus === "sending"
      ) {
        return;
      }
      if (deliveryInFlightRef.current.has(run.id)) {
        return;
      }
      const workspace = workspacesById.get(run.workspaceId);
      if (!workspace) {
        return;
      }
      const isBusy = Boolean(threadStatusById[run.boundThreadId]?.isProcessing);
      if (isBusy) {
        if (run.deliveryStatus !== "queued") {
          deliveryInFlightRef.current.add(run.id);
          void setResearchRunDeliveryStatusService(run.id, "queued")
            .catch((error) => {
              pushErrorToast({
                title: "Research delivery queue failed",
                message: asErrorMessage(error),
              });
            })
            .finally(() => {
              deliveryInFlightRef.current.delete(run.id);
            });
        }
        return;
      }
      deliveryInFlightRef.current.add(run.id);
      void (async () => {
        try {
          await setResearchRunDeliveryStatusService(run.id, "sending");
          if (!workspace.connected) {
            await connectWorkspace(workspace);
          }
          const result = await sendUserMessageToThread(
            workspace,
            run.boundThreadId,
            (() => {
              const baseMessage = buildResearchAnalysisMessage(run);
              const deliveryPrompt =
                deliveryPromptByWorkspace[run.workspaceId] ??
                (loadedDeliveryPromptWorkspaceIdsRef.current.has(run.workspaceId)
                  ? ""
                  : readStoredDeliveryPrompt(run.workspaceId));
              const trimmedPrompt = deliveryPrompt.trim();
              return trimmedPrompt ? `${baseMessage}\n\n${trimmedPrompt}` : baseMessage;
            })(),
            [],
          );
          if (!result || result.status === "sent") {
            await setResearchRunDeliveryStatusService(run.id, "sent");
            return;
          }
          await setResearchRunDeliveryStatusService(
            run.id,
            "failed",
            "Failed to deliver the analysis message.",
          );
        } catch (error) {
          const message = asErrorMessage(error);
          await setResearchRunDeliveryStatusService(run.id, "failed", message).catch(
            () => {},
          );
          pushErrorToast({
            title: "Research delivery failed",
            message,
          });
        } finally {
          deliveryInFlightRef.current.delete(run.id);
        }
      })();
    });
  }, [
    connectWorkspace,
    deliveryPromptByWorkspace,
    runs,
    sendUserMessageToThread,
    threadStatusById,
    workspacesById,
  ]);

  return {
    apiConfig,
    runs,
    activeWorkspaceRuns,
    activeResearchRun,
    activeDeliveryPrompt:
      activeWorkspaceId
        ? deliveryPromptByWorkspace[activeWorkspaceId] ??
          readStoredDeliveryPrompt(activeWorkspaceId)
        : "",
    selectedRunId,
    setSelectedRunId: (runId: string | null) => {
      if (!activeWorkspaceId) {
        return;
      }
      setSelectedRunIdForWorkspace(activeWorkspaceId, runId);
    },
    selectResearchRun,
    createResearchRun,
    retryResearchDelivery,
    dismissResearchRun,
    setDeliveryPrompt,
  };
}
