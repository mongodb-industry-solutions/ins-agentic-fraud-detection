"use client";

import AppShell from "@/components/appShell/AppShell";
import Dashboard from "@/components/dashboard/Dashboard";

/* The only route. There is no login or profile picker — the Dashboard tab is
   what loads when the app opens. */
export default function Home() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
