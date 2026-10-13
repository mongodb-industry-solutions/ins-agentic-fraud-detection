"use client";

import { useEffect, useRef, useState } from "react";

/** Roughly 8 updates a second: fast enough to read as live, slow enough to parse. */
const DEFAULT_INTERVAL_MS = 120;

/**
 * A copy of `text` that updates at most every `intervalMs`.
 *
 * Exists so streamed agent output can be rendered as markdown *while it
 * arrives*. Rendering it per token was the original problem: re-parsing the
 * whole accumulated string on every chunk saturates the main thread on a long
 * report, which is why both renderers used to hold plain text until the stream
 * finished and only then format it.
 *
 * Throttling the markdown *input* keeps the formatting live without the parse
 * cost scaling with token count — the string is parsed ~8 times a second instead
 * of once per token.
 *
 * `immediate` bypasses the throttle, so the final flush is the exact, complete
 * text rather than whatever the last tick happened to catch.
 */
export default function useThrottledText(
  text,
  { intervalMs = DEFAULT_INTERVAL_MS, immediate = false } = {}
) {
  const [throttled, setThrottled] = useState(text);
  const lastFlushRef = useRef(0);

  useEffect(() => {
    if (immediate) {
      setThrottled(text);
      return undefined;
    }

    const elapsed = Date.now() - lastFlushRef.current;
    if (elapsed >= intervalMs) {
      lastFlushRef.current = Date.now();
      setThrottled(text);
      return undefined;
    }

    // Trailing edge: the last chunk of a burst still lands, so a stream that
    // stops mid-interval does not leave the tail unrendered.
    const timer = setTimeout(() => {
      lastFlushRef.current = Date.now();
      setThrottled(text);
    }, intervalMs - elapsed);
    return () => clearTimeout(timer);
  }, [text, intervalMs, immediate]);

  return throttled;
}
