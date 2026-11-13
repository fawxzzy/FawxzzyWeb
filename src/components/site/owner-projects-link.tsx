"use client";

import { useOwnerProjectsAccess } from "@/components/projects/use-owner-projects-access";
import { StaticLink } from "@/components/site/static-link";
import { accountProjectsUrl, isLiveAccountAdapterOrigin } from "@/config/account";

// The Projects tab exists only for the verified owner. The static HTML never contains it, so
// signed-out visitors and every other account see no tab. On the account origin it links to the
// local page; on the main site (hint cookie only) it links to the account-origin page, which
// verifies the owner on the server.
export function OwnerProjectsLink({ current }: { current: boolean }) {
  if (useOwnerProjectsAccess() !== "owner") return null;
  const href = isLiveAccountAdapterOrigin(window.location.origin) ? "/projects" : accountProjectsUrl;
  return (
    <StaticLink aria-current={current ? "page" : undefined} href={href}>
      Projects
    </StaticLink>
  );
}
