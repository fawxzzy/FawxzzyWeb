import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { PublicProjectBoard } from "@/components/projects/public-project-board";
import { PrivateOperations } from "@/components/operations/private-operations";
import { SiteNav } from "@/components/site/site-nav";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Projects",
  "Public project boards with owner-approved roadmap and backlog cards.",
  "/projects",
);

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
