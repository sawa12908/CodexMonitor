import { useCallback, useEffect, useMemo, useState } from "react";
import type { PluginDescriptor } from "@/types";
import { listPlugins } from "@services/tauri";

type UsePluginsArgs = {
  enabled: boolean;
  refreshKey?: string;
};

export function usePlugins({ enabled, refreshKey }: UsePluginsArgs) {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setPlugins([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await listPlugins();
      setPlugins(response);
    } catch (err) {
      setPlugins([]);
      setError(err instanceof Error ? err.message : "Unable to load plugins.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const enabledCount = useMemo(
    () => plugins.filter((plugin) => plugin.enabled && plugin.valid).length,
    [plugins],
  );

  return {
    plugins,
    loading,
    error,
    enabledCount,
    refresh,
  };
}
