import type { Metadata } from "next";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { OwnerProjectBoard } from "@/components/projects/owner-project-board";
import { SiteNav } from "@/components/site/site-nav";
import { publicPageMetadata } from "@/lib/seo";

// Projects is the owner's private view. This static page ships no board data and
// the nav tab only appears for the verified owner (see OwnerProjectsLink); the
// board is fetched from the owner-verified /api/projects/board after sign-in.
// Kept out of the index.
export const metadata: Metadata = {
  ...publicPageMetadata({
    description: "Your project boards.",
    path: "/projects",
    title: "Projects",
  }),
  robots: { follow: false, index: false },
};

export default function ProjectsPage() {
  return (
    <main className="projects-page app-theme-fawxzzy" id="main-content">
      <AmbientBrandBackground intensity="soft" particleCount={5} />
      <div className="shell-container projects-shell">
        <SiteNav current="projects" />
        <OwnerProjectBoard />
      </div>
    </main>
  );
}
