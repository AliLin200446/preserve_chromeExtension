import type { Attempt, Stage } from "./domain";
// Presentation labels only. Persisted status and category values stay unchanged.
export const decisionLabel: Record<Attempt["status"], string> = {
  DRAFT: "In the making",
  APPROVED: "Kept",
  REJECTED: "For revision",
};
export const chapterStatus: Record<Stage["status"], string> = {
  Draft: "Not started",
  "In Progress": "In progress",
  Approved: "Reference kept",
  "Needs Revision": "Revisiting",
};
export const revisionLabel: Record<string, string> = {
  "Product fidelity": "Product details changed",
  "Character identity": "Character identity changed",
  "Occlusion / interaction": "Object interaction is incorrect",
  Lighting: "Lighting drifted",
  Composition: "Composition changed",
  "Motion / temporal consistency": "Motion is inconsistent",
  Other: "Other",
};
export const date = (value: number) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const ordinal = (value: number) => String(value).padStart(2, "0");
