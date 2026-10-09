/** Sidebar structure. `icon` keys resolve against components/icons/Icons.js. */

/* Fraud Patterns sits directly above Fraud Intelligence rather than under
   System: maintaining the ruleset is day-to-day claims work on the same
   subject, not platform configuration, and the pattern a claim matched is read
   in one and explained in the other. */
export const WORKSPACE_NAV = [
  { id: "dashboard", label: "Claims Portfolio", icon: "grid" },
  { id: "customers", label: "Customers", icon: "users" },
  { id: "policies", label: "Policies", icon: "file" },
];

export const FRAUD_INTELLIGENCE_NAV = [
  { id: "fraudPatterns", label: "Fraud Patterns", icon: "activity" },
  { id: "fraudIntelligence", label: "Fraud Intelligence", icon: "shield" },
];

export const DEFAULT_SECTION = "dashboard";

/**
 * What the claim view's back link calls each origin. Driven by returnSection,
 * so drilling in from Fraud Intelligence offers "Back to fraud intelligence"
 * rather than always pointing at the Dashboard.
 */
export const SECTION_LABEL = {
  dashboard: "claims",
  customers: "customers",
  policies: "policies",
  fraudIntelligence: "fraud intelligence",
  fraudPatterns: "fraud patterns",
};

/** Display titles for sections that have no screen of their own yet. */
export const SECTION_TITLE = Object.fromEntries(
  WORKSPACE_NAV.map((item) => [item.id, item.label])
);

export const PROFILE = {
  initials: "PR",
  name: "Patricia Renart",
  team: "Claims operations",
};
