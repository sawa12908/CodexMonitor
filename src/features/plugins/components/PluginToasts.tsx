import X from "lucide-react/dist/esm/icons/x";
import type { PluginRuntimeToast } from "../hooks/usePluginRuntime";
import {
  ToastBody,
  ToastCard,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "../../design-system/components/toast/ToastPrimitives";

type PluginToastsProps = {
  toasts: PluginRuntimeToast[];
  onDismiss: (id: string) => void;
};

export function PluginToasts({ toasts, onDismiss }: PluginToastsProps) {
  if (!toasts.length) {
    return null;
  }

  return (
    <ToastViewport className="plugin-toasts" role="region" ariaLive="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} className="plugin-toast" role="status">
          <ToastHeader className="plugin-toast-header">
            <ToastTitle className="plugin-toast-title">
              {toast.title ?? "Notification"}
            </ToastTitle>
            <button
              type="button"
              className="ghost plugin-toast-dismiss"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss plugin notification"
              title="Dismiss"
            >
              <X size={12} aria-hidden />
            </button>
          </ToastHeader>
          <ToastBody className="plugin-toast-body">{toast.message}</ToastBody>
        </ToastCard>
      ))}
    </ToastViewport>
  );
}
