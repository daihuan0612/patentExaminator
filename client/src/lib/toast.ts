/**
 * Simple toast notification system.
 * Uses a global event bus to communicate with a React component.
 */

export type ToastType = "info" | "warning" | "error";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
let toastId = 0;

export function showToast(message: string, type: ToastType = "info", duration = 5000): void {
  const id = `toast-${++toastId}`;
  const toast: ToastMessage = { id, type, message, duration };

  // Notify all listeners
  for (const listener of listeners) {
    listener(toast);
  }

  // Auto-dismiss after duration
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }
}

export function addToastListener(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissToast(id: string): void {
  // Dispatch a custom event for the ToastContainer to handle
  window.dispatchEvent(new CustomEvent("toast-dismiss", { detail: { id } }));
}
