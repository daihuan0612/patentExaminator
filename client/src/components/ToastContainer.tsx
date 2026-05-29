import { useState, useEffect, useCallback } from "react";
import { addToastListener, type ToastMessage } from "../lib/toast";

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const handleToast = useCallback((toast: ToastMessage) => {
    setToasts((prev) => [...prev, toast]);
  }, []);

  useEffect(() => {
    const unsubscribe = addToastListener(handleToast);
    return unsubscribe;
  }, [handleToast]);

  useEffect(() => {
    const handleDismiss = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        setToasts((prev) => prev.filter((t) => t.id !== detail.id));
      }
    };
    window.addEventListener("toast-dismiss", handleDismiss);
    return () => window.removeEventListener("toast-dismiss", handleDismiss);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" data-testid="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.type}`}
          data-testid={`toast-${toast.type}`}
        >
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
