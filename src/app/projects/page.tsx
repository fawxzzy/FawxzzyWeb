import type { Metadata } from "next";
import { AmbientBrandBackground } from "@/components/ambient/ambient-brand-background";
import { ProjectBoard } from "@/components/projects/project-board";
import { PrivateOperations } from "@/components/operations/private-operations";
import { SiteNav } from "@/components/site/site-nav";

export const metadata: Metadata = {
  title: "Projects",
  description: "A public project-board space awaiting approved source data.",
  robots: { index: false, follow: false },
};

export default function ProjectsPage() {
  return (
    <main className="projects-page app-theme-fawxzzy" id="main-content">
      <AmbientBrandBackground intensity="soft" particleCount={5} />
      <div className="shell-container projects-shell">
        <SiteNav current="projects" />
        <ProjectBoard />
        <PrivateOperations projectView />
      </div>
    </main>
  );
}
