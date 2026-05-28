import { useRef, useEffect, useCallback } from "react";

/**
 * Hook that provides safe async execution with automatic cleanup.
 * - Aborts previous request when a new one starts
 * - Prevents setState after unmount
 * - Returns a stable runAsync function
 *
 * Usage:
 *   const { runAsync, abort } = useSafeAsync();
 *   const result = await runAsync(someAsyncFn);
 */
export function useSafeAsync() {
  const isMountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const runAsync = useCallback(async <T>(
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T | undefined> => {
    // Abort previous request
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const result = await fn(controller.signal);
      if (isMountedRef.current && !controller.signal.aborted) {
        return result;
      }
      return undefined;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return undefined; // Silently ignore abort
      }
      throw e;
    }
  }, []);

  return { runAsync, abort, isMountedRef };
}
