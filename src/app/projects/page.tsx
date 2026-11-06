import type { Metadata } from "next";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { PublicProjectBoard } from "@/components/projects/public-project-board";
import { PrivateOperations } from "@/components/operations/private-operations";
import { SiteNav } from "@/components/site/site-nav";
import { publicPageMetadata } from "@/lib/seo";

// Projects is a main-site page; the account origin serves the same static page
// as the owner's private view and canonicalizes here. Kept out of the index.
export const metadata: Metadata = {
  ...publicPageMetadata({
    description: "Public project boards with owner-approved roadmap and backlog cards.",
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
        <PublicProjectBoard privateBoardSlot={<PrivateOperations projectView />} />
      </div>
    </main>
  );
}
