import { useCallback, useEffect, useRef, useState } from "react";
import type { GitFileStatus, WorkspaceInfo } from "../../../types";
import { appendFrontendDiagnostic, getGitStatus } from "../../../services/tauri";

type GitStatusState = {
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
  error: string | null;
};

const emptyStatus: GitStatusState = {
  branchName: "",
  files: [],
  stagedFiles: [],
  unstagedFiles: [],
  totalAdditions: 0,
  totalDeletions: 0,
  error: null,
};

const REFRESH_INTERVAL_MS = 3000;
export function useGitStatus(activeWorkspace: WorkspaceInfo | null) {
  const [status, setStatus] = useState<GitStatusState>(emptyStatus);
  const requestIdRef = useRef(0);
  const workspaceIdRef = useRef<string | null>(activeWorkspace?.id ?? null);
  const cachedStatusRef = useRef<Map<string, GitStatusState>>(new Map());
  const inFlightRequestRef = useRef<{
    workspaceId: string;
    promise: Promise<void>;
  } | null>(null);
  const workspaceId = activeWorkspace?.id ?? null;

  const resolveBranchName = useCallback(
    (incoming: string | undefined, cached: GitStatusState | undefined) => {
      const trimmed = incoming?.trim();
      if (trimmed && trimmed !== "unknown") {
        return trimmed;
      }
      const cachedBranch = cached?.branchName?.trim();
      return cachedBranch && cachedBranch !== "unknown"
        ? cachedBranch
        : trimmed ?? "";
    },
    [],
  );

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setStatus(emptyStatus);
      return Promise.resolve();
    }
    const inFlightRequest = inFlightRequestRef.current;
    if (inFlightRequest && inFlightRequest.workspaceId === workspaceId) {
      void appendFrontendDiagnostic(
        "frontend.useGitStatus",
        "refresh_skipped_inflight",
        {
          workspaceId,
          requestId: requestIdRef.current,
        },
      );
      return inFlightRequest.promise;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const startedAt = performance.now();
    const promise = getGitStatus(workspaceId)
      .then((data) => {
        const durationMs = Math.round(performance.now() - startedAt);
        const isStale =
          requestIdRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId;
        void appendFrontendDiagnostic("frontend.useGitStatus", "refresh_done", {
          workspaceId,
          requestId,
          durationMs,
          stale: isStale,
          fileCount: data.files.length,
          stagedFileCount: data.stagedFiles.length,
          unstagedFileCount: data.unstagedFiles.length,
          totalAdditions: data.totalAdditions,
          totalDeletions: data.totalDeletions,
        });
        if (isStale) {
          return;
        }
        const cached = cachedStatusRef.current.get(workspaceId);
        const resolvedBranchName = resolveBranchName(data.branchName, cached);
        const nextStatus = {
          ...data,
          branchName: resolvedBranchName,
          error: null,
        };
        setStatus(nextStatus);
        cachedStatusRef.current.set(workspaceId, nextStatus);
      })
      .catch((err) => {
        console.error("Failed to load git status", err);
        const durationMs = Math.round(performance.now() - startedAt);
        const message = err instanceof Error ? err.message : String(err);
        const isStale =
          requestIdRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId;
        void appendFrontendDiagnostic("frontend.useGitStatus", "refresh_error", {
          workspaceId,
          requestId,
          durationMs,
          stale: isStale,
          error: message,
        });
        if (isStale) {
          return;
        }
        const cached = cachedStatusRef.current.get(workspaceId);
        const nextStatus = cached
          ? { ...cached, error: message }
          : { ...emptyStatus, branchName: "unknown", error: message };
        setStatus(nextStatus);
      })
      .finally(() => {
        if (inFlightRequestRef.current?.promise === promise) {
          inFlightRequestRef.current = null;
        }
      });
    inFlightRequestRef.current = { workspaceId, promise };
    return promise;
  }, [resolveBranchName, workspaceId]);

  useEffect(() => {
    if (workspaceIdRef.current !== workspaceId) {
      workspaceIdRef.current = workspaceId;
      requestIdRef.current += 1;
      if (!workspaceId) {
        setStatus(emptyStatus);
        return;
      }
      const cached = cachedStatusRef.current.get(workspaceId);
      setStatus(cached ?? emptyStatus);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setStatus(emptyStatus);
      return;
    }

    const fetchStatus = () => {
      refresh()?.catch(() => {});
    };

    fetchStatus();
    const interval = window.setInterval(fetchStatus, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [refresh, workspaceId]);

  return { status, refresh };
}
