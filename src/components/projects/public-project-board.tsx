"use client";

import type { ReactElement } from "react";
import { ProjectBoard } from "@/components/projects/project-board";
import { buildPublicBoardState } from "@/data/project-board-public-state.mjs";
import emptyPreview from "@/data/project-board-preview.generated.json";
import publicSnapshot from "@/data/project-board-public.generated.json";

// Evaluated once per bundle (and at build time during static prerender). The
// committed, owner-approved snapshot is advanced through the adapter's envelope
// validation; a rejected snapshot throws and fails the build instead of silently
// falling back. No fetch, provider, or environment variable is involved. The
// snapshot is applied here rather than passed from the server page because a
// large server-serialized prop makes React outline the private slot element,
// which ProjectBoard clones.
const publicBoardState = buildPublicBoardState(emptyPreview, publicSnapshot);

export function PublicProjectBoard({ privateBoardSlot }: { privateBoardSlot?: ReactElement<{ active?: boolean }> }) {
  return <ProjectBoard publicBoardState={publicBoardState} privateBoardSlot={privateBoardSlot} />;
}
