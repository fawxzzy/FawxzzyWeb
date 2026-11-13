"use client";

import { useOwnerProjectsAccess } from "@/components/projects/use-owner-projects-access";
import { StaticLink } from "@/components/site/static-link";

// The Projects tab exists only for the verified owner. The static HTML never
// contains it, so signed-out visitors and every other account see no tab.
export function OwnerProjectsLink({ current }: { current: boolean }) {
  if (useOwnerProjectsAccess() !== "owner") return null;
  return (
    <StaticLink aria-current={current ? "page" : undefined} href="/projects">
      Projects
    </StaticLink>
  );
}
