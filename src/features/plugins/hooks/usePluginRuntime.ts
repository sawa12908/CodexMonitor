import { useCallback, useEffect, useRef } from "react";
import { useAppServerEvents } from "@app/hooks/useAppServerEvents";
import {
  pluginDataRead,
  pluginDataWrite,
  pluginEntryRead,
  sendNotification,
} from "@services/tauri";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DebugEntry, PluginDescriptor } from "@/types";
import { playNotificationSound } from "@/utils/notificationSounds";

const DEFAULT_TOAST_DURATION_MS = 4000;
const MAX_TOAST_DURATION_MS = 15000;
const PLUGIN_SCREEN_TOAST_LABEL = "plugin-toast-overlay";

type AgentMessageCompletedEvent = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
  completedAt: number;
};

type TurnCompletedEvent = {
  workspaceId: string;
  threadId: string;
  turnId: string;
  text: string;
  completedAt: number;
};

type PluginToastInput = {
  title?: string;
  message: string;
  durationMs?: number;
};

type PluginSystemNotificationInput = {
  title: string;
  message?: string;
};

type PluginSoundOptions = {
  volumePercent?: number;
};

export type PluginRuntimeToast = {
  id: string;
  pluginId: string;
  title?: string;
  message: string;
  durationMs: number;
};

type PluginRuntimeOptions = {
  enabled: boolean;
  plugins: PluginDescriptor[];
  successSoundUrl: string;
  errorSoundUrl: string;
  onDebug?: (entry: DebugEntry) => void;
};

type RuntimeEventName = "agent:message-completed" | "turn:completed";

type RuntimeEventMap = {
  "agent:message-completed": AgentMessageCompletedEvent;
  "turn:completed": TurnCompletedEvent;
};

type RuntimeEventHandler<K extends RuntimeEventName> = (
  payload: RuntimeEventMap[K],
) => void | Promise<void>;

type PluginHostApi = {
  on: <K extends RuntimeEventName>(
    eventName: K,
    handler: RuntimeEventHandler<K>,
  ) => () => void;
  playSound: (kind?: "success" | "error", options?: PluginSoundOptions) => void;
  showToast: (input: PluginToastInput) => void;
  notify: (input: PluginSystemNotificationInput) => void;
  data: {
    read: <T = unknown>() => Promise<T | null>;
    write: (value: unknown) => Promise<void>;
  };
  log: (message: string, payload?: unknown) => void;
  plugin: Pick<PluginDescriptor, "id" | "name" | "version" | "directory">;
};

type PluginActivateFn = (
  host: PluginHostApi,
) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

type PluginModuleShape = {
  activate?: PluginActivateFn;
  deactivate?: () => void | Promise<void>;
  default?: unknown;
};

function buildPluginKey(plugin: Pick<PluginDescriptor, "id" | "directory">) {
  return `${plugin.id}::${plugin.directory}`;
}

function buildWorkspaceThreadKey(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

function resolveExportedPlugin(moduleExports: unknown): PluginActivateFn | null {
  const exported = moduleExports as PluginModuleShape | PluginActivateFn | null;
  if (typeof exported === "function") {
    return exported;
  }
  if (
    exported &&
    typeof exported === "object" &&
    typeof exported.activate === "function"
  ) {
    return exported.activate;
  }
  if (
    exported &&
    typeof exported === "object" &&
    typeof exported.default === "function"
  ) {
    return exported.default as PluginActivateFn;
  }
  return null;
}

function coerceToastDuration(rawDuration: number | undefined): number {
  if (typeof rawDuration !== "number" || !Number.isFinite(rawDuration)) {
    return DEFAULT_TOAST_DURATION_MS;
  }
  const rounded = Math.round(rawDuration);
  if (rounded < 1000) {
    return 1000;
  }
  if (rounded > MAX_TOAST_DURATION_MS) {
    return MAX_TOAST_DURATION_MS;
  }
  return rounded;
}

function coerceVolumePercent(rawVolumePercent: number | undefined): number {
  if (typeof rawVolumePercent !== "number" || !Number.isFinite(rawVolumePercent)) {
    return 100;
  }
  const rounded = Math.round(rawVolumePercent);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 500) {
    return 500;
  }
  return rounded;
}

function createPluginHandlers() {
  return {
    "agent:message-completed": new Set<
      RuntimeEventHandler<"agent:message-completed">
    >(),
    "turn:completed": new Set<RuntimeEventHandler<"turn:completed">>(),
  };
}

export function usePluginRuntime({
  enabled,
  plugins,
  successSoundUrl,
  errorSoundUrl,
  onDebug,
}: PluginRuntimeOptions) {
  const onDebugRef = useRef(onDebug);
  const lastAgentMessageByThreadRef = useRef<Map<string, string>>(new Map());
  const handlersRef = useRef<Map<string, ReturnType<typeof createPluginHandlers>>>(
    new Map(),
  );
  const cleanupByPluginRef = useRef<Map<string, () => void | Promise<void>>>(new Map());

  useEffect(() => {
    onDebugRef.current = onDebug;
  }, [onDebug]);

  const logDebug = useCallback(
    (label: string, payload?: unknown, source: DebugEntry["source"] = "client") => {
      onDebugRef.current?.({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}-${label}`,
        timestamp: Date.now(),
        source,
        label,
        payload,
      });
    },
    [],
  );

  const showScreenToast = useCallback(
    (pluginId: string, input: PluginToastInput) => {
      const title = String(input.title ?? "").trim();
      const message = String(input.message ?? "").trim();
      if (!message) {
        return;
      }

      const durationMs = coerceToastDuration(input.durationMs);
      void (async () => {
        try {
          const displayText = title ? `${title}: ${message}` : message;
          const monitor = await currentMonitor();
          const workArea = monitor?.workArea;
          const monitorX = workArea?.position.x ?? 0;
          const monitorY = workArea?.position.y ?? 0;
          const monitorWidth = workArea?.size.width ?? 1920;
          const monitorHeight = workArea?.size.height ?? 1080;
          const textLength = Array.from(displayText).length;
          const width = Math.max(240, Math.min(980, 146 + textLength * 22));
          const height = 66;
          const marginBottom = 30;
          const x = Math.round(monitorX + Math.max(0, (monitorWidth - width) / 2));
          const y = Math.round(
            monitorY + Math.max(0, monitorHeight - height - marginBottom),
          );
          const params = new URLSearchParams({
            message: displayText,
            durationMs: String(durationMs),
          });
          const toastUrl = new URL("/plugin-toast-overlay.html", window.location.href);
          toastUrl.search = params.toString();
          toastUrl.hash = "";

          const existingToast = await WebviewWindow.getByLabel(
            PLUGIN_SCREEN_TOAST_LABEL,
          );
          if (existingToast) {
            await existingToast.close().catch(() => undefined);
          }

          const toastWindow = new WebviewWindow(PLUGIN_SCREEN_TOAST_LABEL, {
            url: toastUrl.toString(),
            transparent: true,
            decorations: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            maximizable: false,
            minimizable: false,
            focus: false,
            focusable: false,
            shadow: false,
          });

          void toastWindow.once("tauri://created", () => {
            void (async () => {
              try {
                await toastWindow.setSize(new PhysicalSize(width, height));
                await toastWindow.setPosition(new PhysicalPosition(x, y));
              } catch (error) {
                logDebug(
                  "plugin/runtime/screen-toast-position-error",
                  {
                    pluginId,
                    message,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  "error",
                );
              }
              window.setTimeout(() => {
                void toastWindow.close().catch(() => undefined);
              }, durationMs);
            })();
          });

          void toastWindow.once("tauri://error", (event) => {
            const payload = (event as { payload?: unknown }).payload;
            logDebug(
              "plugin/runtime/screen-toast-window-error",
              {
                pluginId,
                message,
                payload,
              },
              "error",
            );
          });
        } catch (error) {
          logDebug(
            "plugin/runtime/screen-toast-fallback",
            {
              pluginId,
              message,
              error: error instanceof Error ? error.message : String(error),
            },
            "error",
          );
        }
      })();
    },
    [logDebug],
  );

  const unloadAllPlugins = useCallback(() => {
    const cleanupEntries = Array.from(cleanupByPluginRef.current.entries());
    cleanupByPluginRef.current.clear();
    handlersRef.current.clear();
    lastAgentMessageByThreadRef.current.clear();

    for (const [pluginKey, cleanup] of cleanupEntries) {
      try {
        const result = cleanup();
        if (result instanceof Promise) {
          void result.catch((error) => {
            logDebug(
              "plugin/runtime/deactivate-error",
              {
                pluginKey,
                error: error instanceof Error ? error.message : String(error),
              },
              "error",
            );
          });
        }
      } catch (error) {
        logDebug(
          "plugin/runtime/deactivate-error",
          {
            pluginKey,
            error: error instanceof Error ? error.message : String(error),
          },
          "error",
        );
      }
    }
  }, [logDebug]);

  const emitRuntimeEvent = useCallback(
    <K extends RuntimeEventName>(eventName: K, payload: RuntimeEventMap[K]) => {
      const handlerGroups = Array.from(handlersRef.current.entries());
      for (const [pluginKey, pluginHandlers] of handlerGroups) {
        const handlers = pluginHandlers[eventName] as Set<RuntimeEventHandler<K>>;
        for (const handler of handlers) {
          try {
            const result = handler(payload);
            if (result instanceof Promise) {
              void result.catch((error) => {
                logDebug(
                  "plugin/runtime/handler-error",
                  {
                    pluginKey,
                    event: eventName,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  "error",
                );
              });
            }
          } catch (error) {
            logDebug(
              "plugin/runtime/handler-error",
              {
                pluginKey,
                event: eventName,
                error: error instanceof Error ? error.message : String(error),
              },
              "error",
            );
          }
        }
      }
    },
    [logDebug],
  );

  useAppServerEvents({
    onAgentMessageCompleted: (event) => {
      lastAgentMessageByThreadRef.current.set(
        buildWorkspaceThreadKey(event.workspaceId, event.threadId),
        event.text,
      );
      emitRuntimeEvent("agent:message-completed", {
        ...event,
        completedAt: Date.now(),
      });
    },
    onTurnCompleted: (workspaceId, threadId, turnId) => {
      const threadKey = buildWorkspaceThreadKey(workspaceId, threadId);
      const text = lastAgentMessageByThreadRef.current.get(threadKey) ?? "";
      lastAgentMessageByThreadRef.current.delete(threadKey);
      emitRuntimeEvent("turn:completed", {
        workspaceId,
        threadId,
        turnId,
        text,
        completedAt: Date.now(),
      });
    },
  });

  useEffect(() => {
    let disposed = false;

    const loadPlugins = async () => {
      unloadAllPlugins();
      if (!enabled) {
        return;
      }

      const activePlugins = plugins.filter((plugin) => plugin.enabled && plugin.valid);
      for (const plugin of activePlugins) {
        if (disposed) {
          return;
        }
        const pluginKey = buildPluginKey(plugin);
        try {
          const entry = await pluginEntryRead(plugin.id, plugin.directory);
          if (disposed) {
            return;
          }

          const registerHandler = <K extends RuntimeEventName>(
            eventName: K,
            handler: RuntimeEventHandler<K>,
          ) => {
            const pluginHandlers =
              handlersRef.current.get(pluginKey) ?? createPluginHandlers();
            const targetSet = pluginHandlers[eventName] as Set<RuntimeEventHandler<K>>;
            targetSet.add(handler);
            handlersRef.current.set(pluginKey, pluginHandlers);
            return () => {
              const currentPluginHandlers = handlersRef.current.get(pluginKey);
              if (!currentPluginHandlers) {
                return;
              }
              const currentSet = currentPluginHandlers[eventName] as Set<
                RuntimeEventHandler<K>
              >;
              currentSet.delete(handler);
              if (
                currentPluginHandlers["agent:message-completed"].size < 1 &&
                currentPluginHandlers["turn:completed"].size < 1
              ) {
                handlersRef.current.delete(pluginKey);
              }
            };
          };

          const hostApi: PluginHostApi = {
            on: registerHandler,
            playSound: (kind = "success", options) => {
              const soundKind = kind === "error" ? "error" : "success";
              const soundUrl = soundKind === "error" ? errorSoundUrl : successSoundUrl;
              const volumePercent = coerceVolumePercent(options?.volumePercent);
              playNotificationSound(
                soundUrl,
                soundKind,
                onDebugRef.current,
                volumePercent,
              );
            },
            showToast: (input) => {
              showScreenToast(plugin.id, input);
            },
            notify: (input) => {
              const title = String(input.title ?? "").trim();
              const message = String(input.message ?? "").trim();
              if (!title) {
                return;
              }
              void sendNotification(title, message).catch((error) => {
                logDebug(
                  "plugin/runtime/system-notification-error",
                  {
                    pluginId: plugin.id,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  "error",
                );
              });
            },
            data: {
              read: async <T = unknown>() => {
                const response = await pluginDataRead(plugin.id);
                if (!response.exists || !response.content.trim()) {
                  return null;
                }
                try {
                  return JSON.parse(response.content) as T;
                } catch {
                  return response.content as T;
                }
              },
              write: async (value: unknown) => {
                const content =
                  typeof value === "string"
                    ? value
                    : JSON.stringify(value ?? null, null, 2);
                await pluginDataWrite(plugin.id, content);
              },
            },
            log: (message, payload) => {
              logDebug(`plugin/${plugin.id}`, { message, payload });
            },
            plugin: {
              id: plugin.id,
              name: plugin.name,
              version: plugin.version,
              directory: plugin.directory,
            },
          };

          const moduleRecord = {
            exports: {} as unknown,
          };
          const evaluator = new Function(
            "module",
            "exports",
            "host",
            `${entry.content}\n//# sourceURL=${entry.entryPath}`,
          );
          evaluator(moduleRecord, moduleRecord.exports, hostApi);

          const exported =
            (moduleRecord.exports as { default?: unknown }).default ??
            moduleRecord.exports;
          const activate = resolveExportedPlugin(exported);
          if (!activate) {
            throw new Error(
              "Plugin entry must export a function or an object with an activate() function.",
            );
          }

          const activateResult = await activate(hostApi);
          const deactivate =
            typeof activateResult === "function"
              ? activateResult
              : exported &&
                  typeof exported === "object" &&
                  typeof (exported as PluginModuleShape).deactivate === "function"
                ? () => (exported as PluginModuleShape).deactivate?.()
                : null;

          if (deactivate) {
            cleanupByPluginRef.current.set(pluginKey, deactivate);
          } else {
            cleanupByPluginRef.current.set(pluginKey, () => undefined);
          }

          logDebug("plugin/runtime/loaded", {
            pluginId: plugin.id,
            directory: plugin.directory,
            entryPath: entry.entryPath,
          });
        } catch (error) {
          handlersRef.current.delete(pluginKey);
          cleanupByPluginRef.current.delete(pluginKey);
          logDebug(
            "plugin/runtime/load-error",
            {
              pluginId: plugin.id,
              directory: plugin.directory,
              error: error instanceof Error ? error.message : String(error),
            },
            "error",
          );
        }
      }
    };

    void loadPlugins();

    return () => {
      disposed = true;
      unloadAllPlugins();
    };
  }, [
    enabled,
    errorSoundUrl,
    logDebug,
    plugins,
    showScreenToast,
    successSoundUrl,
    unloadAllPlugins,
  ]);
}
