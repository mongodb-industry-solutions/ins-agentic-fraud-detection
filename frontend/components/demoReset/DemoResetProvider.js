"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import ResetDialog from "./ResetDialog";
import ResetLoading from "./ResetLoading";
import useDemoReset from "./useDemoReset";

const DemoResetContext = createContext({ available: false, isResetting: false, requestReset: () => {} });

/** What any screen needs to offer a reset: whether it exists, and how to start one. */
export function useDemoResetControl() {
  return useContext(DemoResetContext);
}

/**
 * Owns the reset's confirmation dialog and loading layer once, so every entry
 * point (the profile menu, the empty Pending assessment panel) opens the same
 * dialog. `onReset` runs after a successful reset so the page can refetch.
 */
export default function DemoResetProvider({ onReset, children }) {
  const { available, database, isResetting, reset } = useDemoReset({ onReset });
  const [isConfirming, setIsConfirming] = useState(false);

  const requestReset = useCallback(() => setIsConfirming(true), []);
  const value = useMemo(
    () => ({ available, isResetting, requestReset }),
    [available, isResetting, requestReset]
  );

  return (
    <DemoResetContext.Provider value={value}>
      {children}
      <ResetDialog
        open={isConfirming}
        database={database}
        onConfirm={() => {
          setIsConfirming(false);
          reset();
        }}
        onCancel={() => setIsConfirming(false)}
      />
      {isResetting && <ResetLoading />}
    </DemoResetContext.Provider>
  );
}
