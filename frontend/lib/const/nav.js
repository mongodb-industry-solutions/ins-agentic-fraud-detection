/** Sidebar structure. `icon` keys resolve against components/icons/Icons.js. */

export const WORKSPACE_NAV = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "customers", label: "Customers", icon: "users" },
  { id: "policies", label: "Policies", icon: "file" },
  { id: "fraudIntelligence", label: "Fraud Intelligence", icon: "shield" },
];

export const SYSTEM_NAV = [
  { id: "fraudPatterns", label: "Fraud Patterns", icon: "activity" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export const ACTIVE_NAV_ID = "dashboard";

export const PROFILE = {
  initials: "AT",
  name: "Alex Tran",
  team: "Claims operations",
};
