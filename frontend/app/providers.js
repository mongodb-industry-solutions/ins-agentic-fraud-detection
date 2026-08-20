"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import LeafyGreenProvider from "@leafygreen-ui/leafygreen-provider";

const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function Providers({ children }) {
  const [theme, setTheme] = useState("dark");

  // The tokens in globals.css switch off [data-theme] on <html>.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <LeafyGreenProvider darkMode={theme === "dark"}>{children}</LeafyGreenProvider>
    </ThemeContext.Provider>
  );
}
