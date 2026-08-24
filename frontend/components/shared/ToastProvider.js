"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import styles from "./ToastProvider.module.css";

const ToastContext = createContext(() => {});

/**
 * The app's one transient-message mechanism, mounted once in providers.js.
 * Every placeholder action anywhere in the app calls useToast() — there is no
 * per-screen toast.
 *
 * Messages are React nodes rather than HTML strings: the emphasis inside them
 * is always the name of a backend function, which <ToastFn> renders, so no
 * caller needs dangerouslySetInnerHTML to get it.
 */
export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((node) => {
    setMessage(node);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 3200);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {message && (
        <div className={styles.toast} role="status" aria-live="polite">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** The backend function a placeholder stands in for, e.g. create_fraud_pattern. */
export function ToastFn({ children }) {
  return <code>{children}</code>;
}
