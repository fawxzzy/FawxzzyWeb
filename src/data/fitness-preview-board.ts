export type FitnessPreviewScreenKey =
  | "today"
  | "session"
  | "routines"
  | "routineList"
  | "createRoutine"
  | "editRoutine"
  | "dayPlan"
  | "dayEditor"
  | "addExercise"
  | "historySessions"
  | "historyDetail"
  | "historyExercises"
  | "exerciseDetail"
  | "settings"
  | "login";

export type FitnessPreviewScreenTemplate = {
  screenKey: FitnessPreviewScreenKey;
  title: string;
  family: "Home" | "Workout" | "Routine" | "History" | "Account";
  referencePath: string;
  assetStem: string;
  baseImageSrc?: string;
  baseImageAlt?: string;
  sourceNote?: string;
};

export type FitnessPreviewSlot = {
  id: string;
  layerNumber: number;
  layerLabel: string;
  iterationLabel: string;
  screenKey: FitnessPreviewScreenKey;
  title: string;
  family: FitnessPreviewScreenTemplate["family"];
  frameRef: string;
  referenceHref: string;
  referencePath: string;
  assetPath: string;
  imageSrc: string | null;
  imageAlt: string;
  sourceNote: string;
};

export type FitnessPreviewLayer = {
  id: string;
  layerNumber: number;
  title: string;
  description: string;
  iterationLabel: string;
  slots: FitnessPreviewSlot[];
};

export const fitnessPreviewBaseUrl = "https://fawxzzy-fitness-local.vercel.app";

const screenTemplates: FitnessPreviewScreenTemplate[] = [
  {
    screenKey: "today",
    title: "Today / Home",
    family: "Home",
    referencePath: "/dev/mobile-regression?scenario=today-default",
    assetStem: "today-home",
    baseImageSrc: "/apps/fitness/screenshots/today-dashboard.png",
    baseImageAlt: "Fitness today dashboard base screen",
    sourceNote: "Existing Trove capture: today dashboard",
  },
  {
    screenKey: "session",
    title: "Active Session",
    family: "Workout",
    referencePath: "/dev/mobile-regression?scenario=active-workout-session",
    assetStem: "active-session",
  },
  {
    screenKey: "routines",
    title: "Routines / Current",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=routines-current-view",
    assetStem: "routines-current",
    baseImageSrc: "/apps/fitness/screenshots/routine-planner.png",
    baseImageAlt: "Fitness routine planner base screen",
    sourceNote: "Existing Trove capture: routine planner",
  },
  {
    screenKey: "routineList",
    title: "Routine Library",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=routines-list-view",
    assetStem: "routine-library",
  },
  {
    screenKey: "createRoutine",
    title: "Create Routine",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=create-routine",
    assetStem: "create-routine",
  },
  {
    screenKey: "editRoutine",
    title: "Edit Routine",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=edit-routine",
    assetStem: "edit-routine",
  },
  {
    screenKey: "dayPlan",
    title: "Routine Day Plan",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=view-day",
    assetStem: "routine-day-plan",
  },
  {
    screenKey: "dayEditor",
    title: "Routine Day Editor",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=edit-day-default",
    assetStem: "routine-day-editor",
  },
  {
    screenKey: "addExercise",
    title: "Add Exercise Picker",
    family: "Routine",
    referencePath: "/dev/mobile-regression?scenario=add-exercise-default",
    assetStem: "add-exercise-picker",
  },
  {
    screenKey: "historySessions",
    title: "History / Sessions",
    family: "History",
    referencePath: "/dev/mobile-regression?scenario=history-sessions-detailed",
    assetStem: "history-sessions",
    baseImageSrc: "/apps/fitness/screenshots/session-history.png",
    baseImageAlt: "Fitness session history base screen",
    sourceNote: "Existing Trove capture: session history",
  },
  {
    screenKey: "historyDetail",
    title: "History / Detail",
    family: "History",
    referencePath: "/dev/mobile-regression?scenario=history-detail-broken-images",
    assetStem: "history-detail",
  },
  {
    screenKey: "historyExercises",
    title: "Exercise History",
    family: "History",
    referencePath: "/dev/mobile-regression?scenario=history-exercises-detailed",
    assetStem: "exercise-history",
    baseImageSrc: "/apps/fitness/screenshots/exercise-history.png",
    baseImageAlt: "Fitness exercise history base screen",
    sourceNote: "Existing Trove capture: exercise history",
  },
  {
    screenKey: "exerciseDetail",
    title: "Exercise Detail",
    family: "History",
    referencePath: "/dev/mobile-regression?scenario=exercise-detail-strength",
    assetStem: "exercise-detail",
  },
  {
    screenKey: "settings",
    title: "Settings",
    family: "Account",
    referencePath: "/settings",
    assetStem: "settings",
  },
  {
    screenKey: "login",
    title: "Login / Auth",
    family: "Account",
    referencePath: "/login",
    assetStem: "login-auth",
  },
];

function buildAssetPath(layerNumber: number, assetStem: string, iterationSlug: string) {
  const layer = String(layerNumber).padStart(2, "0");
  return `/apps/fitness/screen-board/layer-${layer}/${assetStem}-${iterationSlug}.png`;
}

function toFrameRef(layerNumber: number, screenKey: FitnessPreviewScreenKey, iterationSlug: string) {
  return `fitness.layer-${String(layerNumber).padStart(2, "0")}.${screenKey}.${iterationSlug}`;
}

function buildSlot(
  screen: FitnessPreviewScreenTemplate,
  layerNumber: number,
  layerLabel: string,
  iterationLabel: string,
  iterationSlug: string,
  imageSrc: string | null,
): FitnessPreviewSlot {
  return {
    id: `${screen.screenKey}-${iterationSlug}`,
    layerNumber,
    layerLabel,
    iterationLabel,
    screenKey: screen.screenKey,
    title: screen.title,
    family: screen.family,
    frameRef: toFrameRef(layerNumber, screen.screenKey, iterationSlug),
    referenceHref: `${fitnessPreviewBaseUrl}${screen.referencePath}`,
    referencePath: screen.referencePath,
    assetPath: imageSrc ?? buildAssetPath(layerNumber, screen.assetStem, iterationSlug),
    imageSrc,
    imageAlt: screen.baseImageAlt ?? `${screen.title} ${iterationLabel} screenshot slot`,
    sourceNote: screen.sourceNote ?? "Waiting for screenshot replacement",
  };
}

function makeBaseLayer(): FitnessPreviewLayer {
  return {
    id: "layer-01-base",
    layerNumber: 1,
    title: "Layer 1 - Base screens",
    description:
      "Canonical home screens and sub screens. Existing Trove captures fill what is already available; everything else stays as a waiting frame.",
    iterationLabel: "Base",
    slots: screenTemplates.map((screen) =>
      buildSlot(screen, 1, "Layer 1", "Base", "base", screen.baseImageSrc ?? null),
    ),
  };
}

function makeVariationLayer(layerNumber: number, iterationNumber: number): FitnessPreviewLayer {
  const iterationSlug = `v${String(iterationNumber).padStart(2, "0")}`;
  const iterationLabel = `Iteration ${String(iterationNumber).padStart(2, "0")}`;

  return {
    id: `layer-${String(layerNumber).padStart(2, "0")}-${iterationSlug}`,
    layerNumber,
    title: `Layer ${layerNumber} - ${iterationLabel} variations`,
    description:
      "Same screen map as Layer 1, reserved for the next UI pass. Replace each frame image without changing the screen reference.",
    iterationLabel,
    slots: screenTemplates.map((screen) =>
      buildSlot(
        screen,
        layerNumber,
        `Layer ${layerNumber}`,
        iterationLabel,
        iterationSlug,
        null,
      ),
    ),
  };
}

export const fitnessPreviewLayers: FitnessPreviewLayer[] = [
  makeBaseLayer(),
  makeVariationLayer(2, 1),
  makeVariationLayer(3, 2),
];

export function getFitnessPreviewStats(layers = fitnessPreviewLayers) {
  const slots = layers.flatMap((layer) => layer.slots);

  return {
    layerCount: layers.length,
    screenCount: screenTemplates.length,
    slotCount: slots.length,
    filledSlotCount: slots.filter((slot) => slot.imageSrc).length,
  };
}
