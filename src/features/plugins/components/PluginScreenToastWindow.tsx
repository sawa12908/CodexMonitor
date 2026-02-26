import { useEffect, useMemo } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

function coerceDuration(raw: string | null): number {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) {
    return 4000;
  }
  const rounded = Math.round(parsed);
  if (rounded < 1000) {
    return 1000;
  }
  if (rounded > 20000) {
    return 20000;
  }
  return rounded;
}

export function PluginScreenToastWindow() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const title = (params.get("title") ?? "").trim();
  const message = (params.get("message") ?? "任务完成").trim() || "任务完成";
  const durationMs = coerceDuration(params.get("durationMs"));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getCurrentWebviewWindow().close();
    }, durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [durationMs]);

  return (
    <div className="plugin-screen-toast-root">
      <div className="plugin-screen-toast-card" role="status" aria-live="polite">
        {title && <div className="plugin-screen-toast-title">{title}</div>}
        <div className="plugin-screen-toast-message">{message}</div>
      </div>
    </div>
  );
}

