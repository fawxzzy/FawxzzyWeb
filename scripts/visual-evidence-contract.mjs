export const visualEvidenceRoutes = Object.freeze([
  { id: "home", path: "/", family: "marketing" },
  { id: "apps", path: "/apps", family: "catalog" },
  { id: "fitness", path: "/apps/fitness", family: "product-detail" },
  { id: "mazer", path: "/apps/mazer", family: "product-detail" },
  { id: "discover", path: "/discover", family: "editorial" },
  { id: "newsletter", path: "/newsletter", family: "editorial" },
  { id: "trove", path: "/trove", family: "compatibility" },
  { id: "login", path: "/login", family: "utility" },
  { id: "account", path: "/account", family: "account" },
  { id: "confirm", path: "/auth/confirm", family: "utility" },
  { id: "callback", path: "/auth/callback", family: "utility" },
  { id: "reset", path: "/reset-password", family: "utility" },
]);

export const visualEvidenceBrowsers = Object.freeze([
  {
    id: "desktop-chromium",
    engine: "chromium",
    label: "Desktop Chromium",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  },
  {
    id: "mobile-webkit",
    engine: "webkit",
    label: "iPhone-class mobile WebKit",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
]);
