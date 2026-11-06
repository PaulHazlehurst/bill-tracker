// The pages the automatic checks visit. `speed: true` pages also get a
// Lighthouse speed check; those must load from the stand-in database alone.
export const PAGES = [
  { name: "login", path: "/login", signedIn: false, speed: true },
  { name: "my-bills", path: "/dashboard", speed: true },
  { name: "activity", path: "/activity", speed: true },
  { name: "week-ahead", path: "/week" },
  { name: "drug-boards", path: "/drug-boards" },
  { name: "regulations", path: "/regulations" },
  { name: "clients", path: "/clients" },
  { name: "client", path: "/clients/c1" },
  { name: "bill", path: "/bill/hr-2407-119", speed: true },
  { name: "congress", path: "/legislators" },
  { name: "team", path: "/team" },
  { name: "notifications", path: "/notifications" },
  { name: "insights", path: "/insights" },
  { name: "settings", path: "/settings" },
  { name: "data-sources", path: "/api-usage" },
];

export const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];
