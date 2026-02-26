import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import X from "lucide-react/dist/esm/icons/x";
import { useCallback, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import { useSettingsViewCloseShortcuts } from "@/features/settings/hooks/useSettingsViewCloseShortcuts";
import { pluginDataRead, pluginDataWrite } from "@/services/tauri";
import type { AppSettings, PluginDescriptor } from "@/types";
import { openInFileManagerLabel } from "@/utils/platformPaths";

type PluginManagerPanelProps = {
  onClose: () => void;
  appSettings: AppSettings;
  plugins: PluginDescriptor[];
  pluginsLoading: boolean;
  pluginsError: string | null;
  onRefreshPlugins: () => void | Promise<void>;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

function resolveActionError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const COMPLETION_ALERT_PLUGIN_ID = "agent-completion-alert";

function buildPluginCardKey(plugin: Pick<PluginDescriptor, "id" | "directory">) {
  return `${plugin.id}::${plugin.directory}`;
}

function clampVolumePercent(value: number) {
  if (!Number.isFinite(value)) {
    return 100;
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 500) {
    return 500;
  }
  return rounded;
}

export function PluginManagerPanel({
  onClose,
  appSettings,
  plugins,
  pluginsLoading,
  pluginsError,
  onRefreshPlugins,
  onUpdateAppSettings,
}: PluginManagerPanelProps) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionAlertVolumePercent, setCompletionAlertVolumePercent] = useState(100);
  const [volumeLoaded, setVolumeLoaded] = useState(false);
  const [volumeSaving, setVolumeSaving] = useState(false);
  const [volumeDirty, setVolumeDirty] = useState(false);
  const [expandedPluginKeys, setExpandedPluginKeys] = useState<string[]>([]);

  useSettingsViewCloseShortcuts(onClose);

  const enabledPluginCount = useMemo(
    () =>
      plugins.filter(
        (plugin) =>
          plugin.valid && !appSettings.disabledPluginIds.includes(plugin.id),
      ).length,
    [appSettings.disabledPluginIds, plugins],
  );

  const pluginSummary = useMemo(() => {
    if (!appSettings.pluginsEnabled) {
      return "Plugin host is disabled.";
    }
    if (pluginsLoading) {
      return "Loading plugins...";
    }
    if (pluginsError) {
      return "Unable to load plugins.";
    }
    return `${enabledPluginCount}/${plugins.length} plugins enabled.`;
  }, [
    appSettings.pluginsEnabled,
    enabledPluginCount,
    plugins.length,
    pluginsError,
    pluginsLoading,
  ]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setVolumeLoaded(false);
      try {
        const response = await pluginDataRead(COMPLETION_ALERT_PLUGIN_ID);
        let nextVolume = 100;
        if (response.exists && response.content.trim()) {
          try {
            const parsed = JSON.parse(response.content) as { volumePercent?: unknown };
            nextVolume = clampVolumePercent(Number(parsed.volumePercent));
          } catch {
            nextVolume = 100;
          }
        }
        if (active) {
          setCompletionAlertVolumePercent(nextVolume);
          setVolumeDirty(false);
        }
      } catch {
        if (active) {
          setCompletionAlertVolumePercent(100);
          setVolumeDirty(false);
        }
      } finally {
        if (active) {
          setVolumeLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setExpandedPluginKeys((current) => {
      const availableKeys = plugins.map((plugin) => buildPluginCardKey(plugin));
      const availableSet = new Set(availableKeys);
      const retained = current.filter((key) => availableSet.has(key));
      if (retained.length > 0) {
        return retained;
      }
      const completionAlertPlugin = plugins.find(
        (plugin) => plugin.id === COMPLETION_ALERT_PLUGIN_ID,
      );
      if (completionAlertPlugin) {
        return [buildPluginCardKey(completionAlertPlugin)];
      }
      return availableKeys.length > 0 ? [availableKeys[0]] : [];
    });
  }, [plugins]);

  const handleTogglePluginHost = useCallback(() => {
    void (async () => {
      setActionError(null);
      setPendingKey("host");
      try {
        await onUpdateAppSettings({
          ...appSettings,
          pluginsEnabled: !appSettings.pluginsEnabled,
        });
      } catch (error) {
        setActionError(resolveActionError(error, "Unable to update plugin host."));
      } finally {
        setPendingKey((current) => (current === "host" ? null : current));
      }
    })();
  }, [appSettings, onUpdateAppSettings]);

  const handleTogglePlugin = useCallback(
    (plugin: PluginDescriptor) => {
      void (async () => {
        setActionError(null);
        setPendingKey(plugin.id);
        try {
          const currentlyEnabled = !appSettings.disabledPluginIds.includes(plugin.id);
          const nextDisabledPluginIds = currentlyEnabled
            ? appSettings.disabledPluginIds.includes(plugin.id)
              ? appSettings.disabledPluginIds
              : [...appSettings.disabledPluginIds, plugin.id]
            : appSettings.disabledPluginIds.filter((id) => id !== plugin.id);
          await onUpdateAppSettings({
            ...appSettings,
            disabledPluginIds: nextDisabledPluginIds,
          });
        } catch (error) {
          setActionError(
            resolveActionError(error, `Unable to update plugin "${plugin.name}".`),
          );
        } finally {
          setPendingKey((current) => (current === plugin.id ? null : current));
        }
      })();
    },
    [appSettings, onUpdateAppSettings],
  );

  const handleOpenPath = useCallback((path: string) => {
    void (async () => {
      setActionError(null);
      try {
        await revealItemInDir(path);
      } catch (error) {
        setActionError(resolveActionError(error, "Unable to open plugin directory."));
      }
    })();
  }, []);

  const handleSaveCompletionAlertVolume = useCallback(() => {
    void (async () => {
      setActionError(null);
      setVolumeSaving(true);
      try {
        await pluginDataWrite(
          COMPLETION_ALERT_PLUGIN_ID,
          JSON.stringify(
            { volumePercent: clampVolumePercent(completionAlertVolumePercent) },
            null,
            2,
          ),
        );
        setVolumeDirty(false);
      } catch (error) {
        setActionError(
          resolveActionError(error, "Unable to save completion alert volume."),
        );
      } finally {
        setVolumeSaving(false);
      }
    })();
  }, [completionAlertVolumePercent]);

  const handleTogglePluginCard = useCallback((pluginKey: string) => {
    setExpandedPluginKeys((current) =>
      current.includes(pluginKey)
        ? current.filter((key) => key !== pluginKey)
        : [...current, pluginKey],
    );
  }, []);

  return (
    <ModalShell
      className="plugin-manager-overlay"
      cardClassName="plugin-manager-window"
      onBackdropClick={onClose}
      ariaLabelledBy="plugin-manager-title"
    >
      <div className="plugin-manager-titlebar">
        <div className="plugin-manager-title" id="plugin-manager-title">
          Plugin Manager
        </div>
        <button
          type="button"
          className="ghost icon-button plugin-manager-close"
          onClick={onClose}
          aria-label="Close plugin manager"
        >
          <X aria-hidden />
        </button>
      </div>
      <div className="plugin-manager-content">
        <div className="plugin-manager-subtitle">
          Manage plugin host state, discovery, and per-plugin enable switches.
        </div>
        <div className="plugin-manager-summary">{pluginSummary}</div>
        <div className="settings-toggle-row">
          <div className="plugin-manager-row-main">
            <div className="settings-toggle-title">Enable plugin host</div>
            <div className="settings-toggle-subtitle">
              Keep this enabled to discover and activate plugins from plugin
              directories.
            </div>
          </div>
          <button
            type="button"
            className={`settings-toggle ${appSettings.pluginsEnabled ? "on" : ""}`}
            onClick={handleTogglePluginHost}
            aria-pressed={appSettings.pluginsEnabled}
            disabled={pendingKey != null}
          >
            <span className="settings-toggle-knob" />
          </button>
        </div>
        <div className="settings-toggle-row">
          <div className="plugin-manager-row-main">
            <div className="settings-toggle-title">Plugin directories</div>
            <div className="settings-toggle-subtitle">
              {appSettings.pluginDirs.length > 0
                ? appSettings.pluginDirs.join(", ")
                : "No plugin directories configured."}
            </div>
          </div>
          <div className="plugin-manager-row-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (appSettings.pluginDirs.length < 1) {
                  return;
                }
                handleOpenPath(appSettings.pluginDirs[0]);
              }}
              disabled={appSettings.pluginDirs.length < 1}
            >
              {openInFileManagerLabel()}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setActionError(null);
                void onRefreshPlugins();
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        {actionError && <div className="plugin-manager-help plugin-manager-help-error">{actionError}</div>}
        {pluginsLoading && <div className="plugin-manager-help">Loading plugins...</div>}
        {pluginsError && <div className="plugin-manager-help plugin-manager-help-error">{pluginsError}</div>}
        {!pluginsLoading && !pluginsError && appSettings.pluginsEnabled && plugins.length === 0 && (
          <div className="plugin-manager-help">No plugins discovered.</div>
        )}
        {!appSettings.pluginsEnabled && (
          <div className="plugin-manager-help">
            Enable plugin host first, then refresh to discover plugins.
          </div>
        )}
        {!pluginsLoading &&
          !pluginsError &&
          appSettings.pluginsEnabled &&
          plugins.length > 0 && (
            <div className="plugin-manager-plugin-list">
              {plugins.map((plugin) => {
                const pluginKey = buildPluginCardKey(plugin);
                const pluginEnabled =
                  plugin.valid && !appSettings.disabledPluginIds.includes(plugin.id);
                const pluginExpanded = expandedPluginKeys.includes(pluginKey);
                const showCompletionAlertVolumeControl =
                  plugin.id === COMPLETION_ALERT_PLUGIN_ID;
                return (
                  <div
                    className={`plugin-manager-plugin-card ${pluginExpanded ? "is-expanded" : ""}`}
                    key={pluginKey}
                  >
                    <button
                      type="button"
                      className="plugin-manager-plugin-summary"
                      onClick={() => handleTogglePluginCard(pluginKey)}
                      aria-expanded={pluginExpanded}
                    >
                      <div className="plugin-manager-row-main">
                        <div className="plugin-manager-plugin-title">
                          <span className="settings-toggle-title">
                            {plugin.name} <code>{plugin.version}</code>
                          </span>
                          <code className="plugin-manager-plugin-id">{plugin.id}</code>
                        </div>
                        <div className="settings-toggle-subtitle">
                          {plugin.description?.trim() ||
                            plugin.error ||
                            (plugin.valid
                              ? plugin.entryPath
                              : "Plugin entry is missing.")}
                        </div>
                      </div>
                      <ChevronDown className="plugin-manager-plugin-chevron" size={16} />
                    </button>
                    <div className="plugin-manager-plugin-panel">
                      <div className="plugin-manager-plugin-panel-inner">
                        <div className="plugin-manager-plugin-toggle-row">
                          <div className="plugin-manager-row-main">
                            <div className="settings-toggle-title">Enable plugin</div>
                            <div className="settings-toggle-subtitle">
                              Toggle this plugin without changing discovered plugin files.
                            </div>
                          </div>
                          <div className="plugin-manager-row-actions">
                            <button
                              type="button"
                              className="ghost plugin-manager-open-button"
                              onClick={() => handleOpenPath(plugin.directory)}
                            >
                              {openInFileManagerLabel()}
                            </button>
                            <button
                              type="button"
                              className={`settings-toggle ${pluginEnabled ? "on" : ""}`}
                              onClick={() => handleTogglePlugin(plugin)}
                              aria-pressed={pluginEnabled}
                              disabled={!plugin.valid || pendingKey != null}
                              title={
                                plugin.valid
                                  ? undefined
                                  : "Plugin entry file is missing."
                              }
                            >
                              <span className="settings-toggle-knob" />
                            </button>
                          </div>
                        </div>
                        {showCompletionAlertVolumeControl && (
                          <div className="plugin-manager-plugin-volume-row">
                            <div className="settings-toggle-title">
                              Completion alert volume
                            </div>
                            <div className="settings-toggle-subtitle">
                              Set the task-complete sound volume (max 500%).
                            </div>
                            <div className="plugin-manager-volume-controls">
                              <input
                                type="range"
                                className="plugin-manager-volume-slider"
                                min={0}
                                max={500}
                                step={10}
                                value={completionAlertVolumePercent}
                                onChange={(event) => {
                                  setCompletionAlertVolumePercent(
                                    clampVolumePercent(Number(event.target.value)),
                                  );
                                  setVolumeDirty(true);
                                }}
                                disabled={!volumeLoaded || volumeSaving}
                                aria-label="Completion alert volume percent"
                              />
                              <div className="plugin-manager-volume-value">
                                {completionAlertVolumePercent}%
                              </div>
                              <button
                                type="button"
                                className="ghost"
                                onClick={handleSaveCompletionAlertVolume}
                                disabled={!volumeLoaded || volumeSaving || !volumeDirty}
                              >
                                {volumeSaving ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="plugin-manager-plugin-path">{plugin.directory}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </ModalShell>
  );
}
