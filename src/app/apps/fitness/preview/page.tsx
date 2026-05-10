import type { Metadata } from "next";
import Link from "next/link";
import { AmbientFitnessBackground } from "@/components/ambient/ambient-fitness-background";
import { FitnessPreviewBoard } from "@/components/catalog/fitness-preview-board";

export const metadata: Metadata = {
  title: "Fitness Preview Board",
  description: "Layered screenshot slots and reference frames for the Fitness app UI.",
};

export default function FitnessPreviewBoardPage() {
  return (
    <div className="catalog-page app-theme-sage">
      <AmbientFitnessBackground
        intensity="high"
        particleCount={18}
        pulseEnabled
        palette={{
          base: "#070C0A",
          glow: "#7F977C",
          glowStrong: "#A4B5A3",
          wisp: "#5C725D",
          particle: "#CFD8D0",
          warm: "#1C2420",
        }}
      />

      <div className="shell-container relative z-10 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-stroke/25 bg-panel/70 p-3 shadow-[0_18px_54px_rgba(0,0,0,0.24)] backdrop-blur">
          <Link className="catalog-button catalog-button--secondary" href="/#fitness">
            Back to Fitness preview
          </Link>
          <a className="catalog-button catalog-button--primary" href="https://fawxzzy-fitness-local.vercel.app" rel="noreferrer" target="_blank">
            Open Fitness app
          </a>
        </div>

        <FitnessPreviewBoard variant="page" />
      </div>
    </div>
  );
}
