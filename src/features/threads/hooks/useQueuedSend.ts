import { useCallback, useEffect, useMemo, useState } from "react";
import { pushErrorToast } from "@/services/toasts";
import type {
  AppMention,
  ComposerSendIntent,
  FollowUpMessageBehavior,
  QueuedMessage,
  SendMessageResult,
  WorkspaceInfo,
} from "@/types";

type UseQueuedSendOptions = {
  activeThreadId: string | null;
  activeTurnId: string | null;
  isProcessing: boolean;
  isReviewing: boolean;
  queueFlushPaused?: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: FollowUpMessageBehavior;
  appsEnabled: boolean;
  activeWorkspace: WorkspaceInfo | null;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    appMentions?: AppMention[],
    options?: { sendIntent?: ComposerSendIntent },
  ) => Promise<SendMessageResult>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
  ) => Promise<void | SendMessageResult>;
  startFork: (text: string) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startApps: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  createResearchRun?: (title: string) => Promise<unknown>;
  startStatus: (text: string) => Promise<void>;
  clearActiveImages: () => void;
};

type UseQueuedSendResult = {
  queuedByThread: Record<string, QueuedMessage[]>;
  activeQueue: QueuedMessage[];
  handleSend: (
    text: string,
    images?: string[],
    appMentions?: AppMention[],
    submitIntent?: ComposerSendIntent,
  ) => Promise<void>;
  queueMessage: (
    text: string,
    images?: string[],
    appMentions?: AppMention[],
  ) => Promise<void>;
  removeQueuedMessage: (threadId: string, messageId: string) => void;
};

type SlashCommandKind =
  | "apps"
  | "compact"
  | "fork"
  | "mcp"
  | "new"
  | "research"
  | "resume"
  | "review"
  | "status";

function parseSlashCommand(text: string, appsEnabled: boolean): SlashCommandKind | null {
  if (appsEnabled && /^\/apps\b/i.test(text)) {
    return "apps";
  }
  if (/^\/fork\b/i.test(text)) {
    return "fork";
  }
  if (/^\/mcp\b/i.test(text)) {
    return "mcp";
  }
  if (/^\/review\b/i.test(text)) {
    return "review";
  }
  if (/^\/compact\b/i.test(text)) {
    return "compact";
  }
  if (/^\/new\b/i.test(text)) {
    return "new";
  }
  if (/^\/research\s+start\b/i.test(text)) {
    return "research";
  }
  if (/^\/resume\b/i.test(text)) {
    return "resume";
  }
  if (/^\/status\b/i.test(text)) {
    return "status";
  }
  return null;
}

function createQueueFlushBarrierKey(
  activeTurnId: string | null,
  isProcessing: boolean,
  isReviewing: boolean,
): string {
  return `${activeTurnId ?? ""}:${isProcessing ? "1" : "0"}:${isReviewing ? "1" : "0"}`;
}

export function useQueuedSend({
  activeThreadId,
  activeTurnId,
  isProcessing,
  isReviewing,
  queueFlushPaused = false,
  steerEnabled,
  followUpMessageBehavior,
  appsEnabled,
  activeWorkspace,
  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessage,
  sendUserMessageToThread,
  startFork,
  startReview,
  startResume,
  startCompact,
  startApps,
  startMcp,
  createResearchRun,
  startStatus,
  clearActiveImages,
}: UseQueuedSendOptions): UseQueuedSendResult {
  const [queuedByThread, setQueuedByThread] = useState<
    Record<string, QueuedMessage[]>
  >({});
  const [inFlightByThread, setInFlightByThread] = useState<
    Record<string, QueuedMessage | null>
  >({});
  const [hasStartedByThread, setHasStartedByThread] = useState<
    Record<string, boolean>
  >({});
  const [flushBarrierByThread, setFlushBarrierByThread] = useState<
    Record<string, string | null>
  >({});

  const activeQueue = useMemo(() => {
    if (!activeThreadId) {
      return [];
    }
    const queued = queuedByThread[activeThreadId] ?? [];
    const inFlight = inFlightByThread[activeThreadId] ?? null;
    const hasStarted = hasStartedByThread[activeThreadId] ?? false;
    if (!inFlight || hasStarted) {
      return queued;
    }
    const visibleInFlight: QueuedMessage = {
      ...inFlight,
      state: "sending",
    };
    return [visibleInFlight, ...queued];
  }, [
    activeThreadId,
    hasStartedByThread,
    inFlightByThread,
    queuedByThread,
  ]);

  const enqueueMessage = useCallback((threadId: string, item: QueuedMessage) => {
    setQueuedByThread((prev) => ({
      ...prev,
      [threadId]: [...(prev[threadId] ?? []), item],
    }));
  }, []);

  const clearInFlightMessage = useCallback((threadId: string) => {
    setInFlightByThread((prev) => {
      if (!prev[threadId]) {
        return prev;
      }
      return { ...prev, [threadId]: null };
    });
    setHasStartedByThread((prev) => {
      if (!prev[threadId]) {
        return prev;
      }
      return { ...prev, [threadId]: false };
    });
  }, []);

  const setFlushBarrier = useCallback((threadId: string, barrier: string | null) => {
    setFlushBarrierByThread((prev) => {
      if ((prev[threadId] ?? null) === barrier) {
        return prev;
      }
      return { ...prev, [threadId]: barrier };
    });
  }, []);

  const clearFlushBarrier = useCallback(
    (threadId: string) => {
      setFlushBarrier(threadId, null);
    },
    [setFlushBarrier],
  );

  const removeQueuedMessage = useCallback(
    (threadId: string, messageId: string) => {
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter(
          (entry) => entry.id !== messageId,
        ),
      }));
    },
    [],
  );

  const prependQueuedMessage = useCallback((threadId: string, item: QueuedMessage) => {
    setQueuedByThread((prev) => ({
      ...prev,
      [threadId]: [item, ...(prev[threadId] ?? [])],
    }));
  }, []);

  const createQueuedItem = useCallback(
    (text: string, images: string[], appMentions: AppMention[]): QueuedMessage => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      createdAt: Date.now(),
      images,
      state: "queued",
      ...(appMentions.length > 0 ? { appMentions } : {}),
    }),
    [],
  );

  const restoreQueuedMessage = useCallback(
    (
      threadId: string,
      item: QueuedMessage,
      options?: { pauseFlushBarrier?: string | null },
    ) => {
      clearInFlightMessage(threadId);
      if (options?.pauseFlushBarrier) {
        setFlushBarrier(threadId, options.pauseFlushBarrier);
      } else {
        clearFlushBarrier(threadId);
      }
      prependQueuedMessage(threadId, { ...item, state: "queued" });
    },
    [
      clearFlushBarrier,
      clearInFlightMessage,
      prependQueuedMessage,
      setFlushBarrier,
    ],
  );

  const runSlashCommand = useCallback(
    async (command: SlashCommandKind, trimmed: string) => {
      if (command === "fork") {
        await startFork(trimmed);
        return;
      }
      if (command === "review") {
        await startReview(trimmed);
        return;
      }
      if (command === "resume") {
        await startResume(trimmed);
        return;
      }
      if (command === "compact") {
        await startCompact(trimmed);
        return;
      }
      if (command === "apps") {
        await startApps(trimmed);
        return;
      }
      if (command === "mcp") {
        await startMcp(trimmed);
        return;
      }
      if (command === "research") {
        const match = trimmed.match(/^\/research\s+start\b/i);
        const title = trimmed.replace(/^\/research\s+start\b/i, "").trim();
        if (!match) {
          return;
        }
        if (!title) {
          pushErrorToast({
            title: "Research command incomplete",
            message: "Use /research start <title> to create a tracked run.",
          });
          return;
        }
        if (!createResearchRun) {
          pushErrorToast({
            title: "Research runs unavailable",
            message: "Research tracking has not been initialized for this workspace.",
          });
          return;
        }
        await createResearchRun(title);
        return;
      }
      if (command === "status") {
        await startStatus(trimmed);
        return;
      }
      if (command === "new" && activeWorkspace) {
        const threadId = await startThreadForWorkspace(activeWorkspace.id);
        const rest = trimmed.replace(/^\/new\b/i, "").trim();
        if (threadId && rest) {
          await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
        }
      }
    },
    [
      activeWorkspace,
      sendUserMessageToThread,
      startFork,
      startReview,
      startResume,
      startCompact,
      startApps,
      startMcp,
      createResearchRun,
      startStatus,
      startThreadForWorkspace,
    ],
  );

  const handleSend = useCallback(
    async (
      text: string,
      images: string[] = [],
      appMentions: AppMention[] = [],
      submitIntent: ComposerSendIntent = "default",
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed, appsEnabled);
      const nextImages = command ? [] : images;
      const nextMentions = command ? [] : appMentions;
      const canSteerCurrentTurn =
        isProcessing && steerEnabled && Boolean(activeTurnId);
      const effectiveIntent: ComposerSendIntent = !isProcessing
        ? "default"
        : submitIntent === "queue"
          ? "queue"
          : submitIntent === "steer"
            ? canSteerCurrentTurn
              ? "steer"
              : "queue"
            : followUpMessageBehavior === "steer" && canSteerCurrentTurn
              ? "steer"
              : "queue";
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      if (isProcessing && activeThreadId && effectiveIntent === "queue") {
        const item = createQueuedItem(trimmed, nextImages, nextMentions);
        enqueueMessage(activeThreadId, item);
        clearActiveImages();
        return;
      }
      if (activeWorkspace && !activeWorkspace.connected) {
        await connectWorkspace(activeWorkspace);
      }
      if (command) {
        await runSlashCommand(command, trimmed);
        clearActiveImages();
        return;
      }
      const sendResult =
        nextMentions.length > 0
          ? await sendUserMessage(trimmed, nextImages, nextMentions, {
            sendIntent: effectiveIntent,
          })
          : await sendUserMessage(trimmed, nextImages, undefined, {
          sendIntent: effectiveIntent,
          });
      if (
        sendResult.status === "steer_failed" &&
        activeThreadId &&
        isProcessing
      ) {
        enqueueMessage(activeThreadId, createQueuedItem(trimmed, nextImages, nextMentions));
      }
      clearActiveImages();
    },
    [
      activeThreadId,
      appsEnabled,
      activeWorkspace,
      clearActiveImages,
      connectWorkspace,
      createQueuedItem,
      enqueueMessage,
      activeTurnId,
      followUpMessageBehavior,
      isProcessing,
      isReviewing,
      steerEnabled,
      runSlashCommand,
      sendUserMessage,
    ],
  );

  const queueMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
      appMentions: AppMention[] = [],
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed, appsEnabled);
      const nextImages = command ? [] : images;
      const nextMentions = command ? [] : appMentions;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      if (!activeThreadId) {
        return;
      }
      const item = createQueuedItem(trimmed, nextImages, nextMentions);
      enqueueMessage(activeThreadId, item);
      clearActiveImages();
    },
    [
      activeThreadId,
      appsEnabled,
      clearActiveImages,
      createQueuedItem,
      enqueueMessage,
      isReviewing,
    ],
  );

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const flushBarrier = flushBarrierByThread[activeThreadId] ?? null;
    if (!flushBarrier) {
      return;
    }
    const currentBarrier = createQueueFlushBarrierKey(
      activeTurnId,
      isProcessing,
      isReviewing,
    );
    if (flushBarrier === currentBarrier) {
      return;
    }
    clearFlushBarrier(activeThreadId);
  }, [
    activeThreadId,
    activeTurnId,
    clearFlushBarrier,
    flushBarrierByThread,
    isProcessing,
    isReviewing,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const inFlight = inFlightByThread[activeThreadId];
    if (!inFlight) {
      return;
    }
    if (isProcessing || isReviewing) {
      if (!hasStartedByThread[activeThreadId]) {
        setHasStartedByThread((prev) => ({
          ...prev,
          [activeThreadId]: true,
        }));
      }
      return;
    }
    if (hasStartedByThread[activeThreadId]) {
      clearInFlightMessage(activeThreadId);
    }
  }, [
    activeThreadId,
    clearInFlightMessage,
    hasStartedByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
  ]);

  useEffect(() => {
    if (!activeThreadId || isProcessing || isReviewing || queueFlushPaused) {
      return;
    }
    if (inFlightByThread[activeThreadId]) {
      return;
    }
    if (flushBarrierByThread[activeThreadId]) {
      return;
    }
    const queue = queuedByThread[activeThreadId] ?? [];
    if (queue.length === 0) {
      return;
    }
    const threadId = activeThreadId;
    const nextItem = queue[0];
    setInFlightByThread((prev) => ({ ...prev, [threadId]: nextItem }));
    setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
    setQueuedByThread((prev) => ({
      ...prev,
      [threadId]: (prev[threadId] ?? []).slice(1),
    }));
    (async () => {
      try {
        const trimmed = nextItem.text.trim();
        const command = parseSlashCommand(trimmed, appsEnabled);
        if (command) {
          await runSlashCommand(command, trimmed);
          if (command !== "review") {
            setHasStartedByThread((prev) => ({
              ...prev,
              [threadId]: true,
            }));
          }
        } else {
          const queuedMentions = nextItem.appMentions ?? [];
          const sendResult =
            queuedMentions.length > 0
              ? await sendUserMessage(
                nextItem.text,
                nextItem.images ?? [],
                queuedMentions,
              )
              : await sendUserMessage(nextItem.text, nextItem.images ?? []);
          if (sendResult?.status === "blocked") {
            restoreQueuedMessage(threadId, nextItem, {
              pauseFlushBarrier: createQueueFlushBarrierKey(
                activeTurnId,
                isProcessing,
                isReviewing,
              ),
            });
            return;
          }
          if (sendResult?.status !== "sent") {
            restoreQueuedMessage(threadId, nextItem);
            return;
          }
        }
      } catch {
        restoreQueuedMessage(threadId, nextItem);
      }
    })();
  }, [
    activeThreadId,
    appsEnabled,
    activeTurnId,
    flushBarrierByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
    queueFlushPaused,
    queuedByThread,
    restoreQueuedMessage,
    runSlashCommand,
    sendUserMessage,
  ]);

  return {
    queuedByThread,
    activeQueue,
    handleSend,
    queueMessage,
    removeQueuedMessage,
  };
}
