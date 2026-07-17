import type { CatalogActionLabel, CatalogApp } from "@/data/apps";

export type CatalogAction = {
  label: CatalogActionLabel;
  href: string | null;
  kind: "external" | "disabled";
  emphasis: "primary" | "secondary";
  navigation: "same-tab" | "new-tab";
};

export function getAppActions(app: CatalogApp) {
  const actions: CatalogAction[] = [
    {
      label: "Open app",
      href: app.origin.current,
      kind: "external",
      emphasis: "primary",
      navigation: "new-tab",
    },
  ];

  return actions;
}
