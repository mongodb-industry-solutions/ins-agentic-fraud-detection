"use client";

import { useCallback, useEffect, useState } from "react";

import { useToast } from "@/components/shared/ToastProvider";
import { getDemoResetStatus, resetDemo } from "@/lib/api/admin";

/**
 * The demo reset: whether the backend offers it, and the action itself.
 * `onReset` runs after a successful reset so the screens can refetch.
 */
export default function useDemoReset({ onReset } = {}) {
  const [status, setStatus] = useState(null);
  const [isResetting, setIsResetting] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    const controller = new AbortController();
    getDemoResetStatus({ signal: controller.signal })
      .then(setStatus)
      // An older backend without the route, or one that is unreachable: the
      // button simply stays hidden.
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, []);

  const reset = useCallback(async () => {
    setIsResetting(true);
    try {
      await resetDemo();
      showToast("Demo data reset to its starting state.");
      onReset?.();
    } catch (error) {
      showToast(error.message || "Could not reset the demo data.");
    } finally {
      setIsResetting(false);
    }
  }, [onReset, showToast]);

  // `available` is false when the backend has no reset route (or is unreachable).
  return { available: Boolean(status), database: status?.database, isResetting, reset };
}
