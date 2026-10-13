import Dexie, { type Table } from "dexie";
import type { PlatformProvenance } from "./platforms/types";
export type ID = string;
export type Status = "Draft" | "In Progress" | "Approved" | "Needs Revision";
export interface Workflow {
  id: ID;
  name: string;
  description: string;
  platform: string;
  objective: string;
  createdAt: number;
  sample?: boolean;
}
export interface Stage {
  id: ID;
  workflowId: ID;
  name: string;
  order: number;
  status: Status;
  currentCheckpointId?: ID;
  visualPosition?: { x: number; y: number };
}
export type RuleMode = "PRESERVE" | "ADAPT" | "CHANGE" | "IGNORE";
export interface ReferenceContract {
  version: number;
  knownFailurePoints?: string;
  attributes: { name: string; mode: RuleMode; notes: string }[];
}
export const promptLabels = {
  subject: "Subject",
  productDetail: "Product detail",
  lighting: "Lighting",
  composition: "Composition",
  negative: "Negative prompt",
  reference: "Reference instructions",
  preservation: "Preservation requirements",
  objective: "Stage objective",
  notes: "Additional notes",
};
export type PromptSchema = { version: number } & Record<
  keyof typeof promptLabels,
  string
>;
export const failureCategories = [
  "Product fidelity",
  "Character identity",
  "Occlusion / interaction",
  "Lighting",
  "Composition",
  "Motion / temporal consistency",
  "Other",
];
export interface FailureReport {
  categories: string[];
  explanation: string;
  createdAt: number;
}
export interface Attempt {
  externalSource?: PlatformProvenance;
  id: ID;
  stageId: ID;
  workflowId: ID;
  createdAt: number;
  updatedAt: number;
  sourceCheckpointId?: ID;
  previousAttemptId?: ID;
  parentIterationId?: ID;
  image?: Blob;
  prompt: PromptSchema;
  contract: ReferenceContract;
  platform: string;
  notes: string;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  failure?: FailureReport;
  previousFailure?: FailureReport;
  retryBrief?: string;
  revisionContext?: RevisionContext;
  revisionDirection?: string;
}
export interface Checkpoint {
  externalSource?: PlatformProvenance;
  id: ID;
  attemptId: ID;
  stageId: ID;
  workflowId: ID;
  createdAt: number;
  prompt: PromptSchema;
  contract: ReferenceContract;
  image: Blob;
  platform: string;
  notes: string;
}
export const annotationCategories = [
  "Product Fidelity",
  "Logo / Typography",
  "Character Identity",
  "Occlusion / Interaction",
  "Lighting",
  "Composition",
  "Motion / Temporal Consistency",
  "Other",
] as const;
export type AnnotationCategory = (typeof annotationCategories)[number];
export interface ImageVersion {
  id: ID;
  attemptId: ID;
  workflowId: ID;
  image: Blob;
  createdAt: number;
}
export interface ImageAnnotation {
  id: ID;
  attemptId: ID;
  workflowId: ID;
  imageVersionId: ID;
  x: number;
  y: number;
  note: string;
  category: AnnotationCategory;
  createdAt: number;
  updatedAt: number;
}
export interface RevisionContext {
  parentIterationId: ID;
  sourceCheckpointId: ID;
  imageVersionId?: ID;
  annotations: ImageAnnotation[];
  failure?: FailureReport;
  createdAt: number;
}
export function normalizePoint(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    throw Error("Invalid image dimensions.");
  return {
    x: Math.max(0, Math.min(1, x / width)),
    y: Math.max(0, Math.min(1, y / height)),
  };
}
export function resolveReference(attempt: Attempt, checkpoints: Checkpoint[]) {
  return checkpoints.find(
    (c) =>
      c.id === attempt.sourceCheckpointId &&
      c.workflowId === attempt.workflowId,
  );
}
export async function imageVersionKey(attemptId: string, image: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await image.arrayBuffer());
  return (
    attemptId +
    ":" +
    Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export function compileRecovery(
  a: Attempt,
  sourceLabel: string,
  annotations: ImageAnnotation[] = [],
  concise = false,
) {
  const context = a.revisionContext;
  const pins = context?.annotations ?? annotations;
  const failure = context?.failure ?? a.failure ?? a.previousFailure;
  const rules = (modes: RuleMode[]) =>
    a.contract.attributes
      .filter((r) => modes.includes(r.mode))
      .map((r) => r.name + (r.notes ? ` — ${r.notes}` : ""))
      .join("; ") || "None specified";
  const failed = failure
    ? [...failure.categories, failure.explanation].filter(Boolean).join("; ")
    : "No failure report recorded";
  const notes =
    pins
      .map(
        (p, i) =>
          `${i + 1}. ${p.category}: ${p.note || "Review marked area"}${concise ? "" : ` [x=${p.x.toFixed(4)}, y=${p.y.toFixed(4)}; image=${p.imageVersionId}]`}`,
      )
      .join("\n") || "No annotations";
  const direction =
    a.revisionDirection?.trim() ||
    a.prompt.notes.trim() ||
    "Use the approved reference. Address the reported failures while retaining the specified elements.";
  if (concise)
    return [
      "Use the approved reference: " + sourceLabel + ".",
      exportPrompt(a.prompt, a.contract, true),
      "Previous failure: " + failed,
      "Annotation notes: " + notes,
      "Next generation instructions: " + direction,
    ].join("\n\n");
  const sections = [
    [
      "SOURCE REFERENCE",
      sourceLabel +
        (concise
          ? ""
          : `\nCheckpoint: ${context?.sourceCheckpointId ?? a.sourceCheckpointId ?? "Unavailable"}\nParent iteration: ${context?.parentIterationId ?? a.id}`),
    ],
    [
      "CURRENT OBJECTIVE",
      a.prompt.objective || a.prompt.subject || "Complete this stage",
    ],
    ["WHAT MUST STAY THE SAME", rules(["PRESERVE"])],
    [
      "WHAT SHOULD CHANGE",
      `Change: ${rules(["CHANGE"])}\nAdapt: ${rules(["ADAPT"])}\nIgnore: ${rules(["IGNORE"])}`,
    ],
    [
      "WHAT FAILED PREVIOUSLY",
      failed +
        (a.contract.knownFailurePoints
          ? `\nKnown failure points: ${a.contract.knownFailurePoints}`
          : ""),
    ],
    ["ANNOTATION NOTES", notes],
    ["NEXT GENERATION INSTRUCTIONS", direction],
  ];
  if (!concise)
    sections.push([
      "STRUCTURED PROMPT SNAPSHOT",
      exportPrompt(a.prompt, a.contract),
    ]);
  return sections
    .map(([title, value]) => `${title}:\n${value}`)
    .join(concise ? "\n" : "\n\n");
}
export class PreserveDB extends Dexie {
  imageVersions!: Table<ImageVersion>;
  annotations!: Table<ImageAnnotation>;
  workflows!: Table<Workflow>;
  stages!: Table<Stage>;
  attempts!: Table<Attempt>;
  checkpoints!: Table<Checkpoint>;
  settings!: Table<{ key: string; value: string }>;
  constructor(name = "preserve") {
    super(name);
    this.version(1).stores({
      workflows: "id,createdAt",
      stages: "id,workflowId,order",
      attempts: "id,stageId,workflowId,sourceCheckpointId,previousAttemptId",
      checkpoints: "id,attemptId,stageId,workflowId",
      settings: "key",
    });
    this.version(2).stores({
      imageVersions: "id,attemptId,workflowId,createdAt",
      annotations: "id,attemptId,workflowId,imageVersionId",
    });
  }
}
export const db = new PreserveDB();
const id = () => crypto.randomUUID();
const clone = <T>(value: T): T => structuredClone(value);
export const emptyPrompt = (): PromptSchema => ({
  version: 1,
  subject: "",
  productDetail: "",
  lighting: "",
  composition: "",
  negative: "",
  reference: "",
  preservation: "",
  objective: "",
  notes: "",
});
export const defaultContract = (): ReferenceContract => ({
  version: 1,
  attributes: [
    "Product geometry",
    "Product label and logo",
    "Material and texture",
    "Character identity",
    "Wardrobe",
    "Lighting",
    "Composition",
    "Background",
    "Camera position",
  ].map((name, i) => ({
    name,
    mode: i < 5 ? "PRESERVE" : i < 7 ? "ADAPT" : "CHANGE",
    notes: "",
  })),
});
export function exportPrompt(
  p: PromptSchema,
  c: ReferenceContract,
  concise = false,
) {
  const sections = Object.entries(promptLabels)
    .filter(([key]) => p[key as keyof typeof promptLabels].trim())
    .map(
      ([key, label]) =>
        `${label.toUpperCase()}:\n${p[key as keyof typeof promptLabels].trim()}`,
    );
  for (const mode of ["PRESERVE", "ADAPT", "CHANGE", "IGNORE"] as const) {
    const attrs = c.attributes
      .filter((a) => a.mode === mode)
      .map((a) => a.name + (a.notes ? ` (${a.notes})` : ""));
    if (attrs.length) sections.push(`${mode}:\n${attrs.join(", ")}`);
  }
  if (c.knownFailurePoints?.trim())
    sections.push(`KNOWN FAILURE POINTS:\n${c.knownFailurePoints.trim()}`);
  return concise
    ? sections.map((s) => s.replace(":\n", ": ")).join(". ")
    : sections.join("\n\n");
}
export function exportRetryBrief(
  source: string,
  contract: ReferenceContract,
  objective: string,
  failure?: FailureReport,
) {
  return `SOURCE:\n${source}\n\nPRESERVE:\n${contract.attributes
    .filter((a) => a.mode === "PRESERVE")
    .map((a) => a.name + (a.notes ? ` — ${a.notes}` : ""))
    .join(
      "\n",
    )}\n\nCURRENT OBJECTIVE:\n${objective || "Complete the current stage."}\n\nPREVIOUS FAILURE:\n${failure ? [...failure.categories, failure.explanation].filter(Boolean).join("\n") : "No failure reported."}\n\nNEXT ATTEMPT:\nReuse the approved source reference.\nKeep previously approved attributes unchanged.\nFocus modifications on the stated stage objective.\nReview the output against reported failure categories.`;
}
export class Repository {
  constructor(public database: PreserveDB) {}
  async createWorkflow(
    input: Omit<Workflow, "id" | "createdAt">,
    template = true,
  ) {
    const w = { ...input, id: id(), createdAt: Date.now() };
    await this.database.transaction(
      "rw",
      this.database.workflows,
      this.database.stages,
      this.database.settings,
      async () => {
        await this.database.workflows.add(w);
        await this.database.settings.put({
          key: "activeWorkflow",
          value: w.id,
        });
        const names = template
          ? [
              "Product Studio Shot",
              "Model Shot",
              "Model + Product Ad Shot",
              "Model Ad Video",
            ]
          : ["First stage"];
        await this.database.stages.bulkAdd(
          names.map((name, order) => ({
            id: id(),
            workflowId: w.id,
            name,
            order,
            status: "Draft" as const,
          })),
        );
      },
    );
    return w;
  }
  async addStage(workflowId: ID, name: string) {
    if (!name.trim()) throw Error("A stage needs a name.");
    const stages = await this.database.stages.where({ workflowId }).toArray();
    const stage: Stage = {
      id: id(),
      workflowId,
      name: name.trim(),
      order: Math.max(-1, ...stages.map((s) => s.order)) + 1,
      status: "Draft",
    };
    await this.database.stages.add(stage);
    return stage;
  }
  async reorder(workflowId: ID, ids: ID[]) {
    await this.database.transaction("rw", this.database.stages, async () => {
      const stages = await this.database.stages.where({ workflowId }).toArray();
      if (
        ids.length !== stages.length ||
        new Set(ids).size !== ids.length ||
        stages.some((s) => !ids.includes(s.id))
      )
        throw Error("Invalid stage order.");
      await Promise.all(
        ids.map((key, order) => this.database.stages.update(key, { order })),
      );
    });
  }
  async deleteStage(stageId: ID) {
    await this.database.transaction(
      "rw",
      this.database.stages,
      this.database.attempts,
      this.database.checkpoints,
      this.database.annotations,
      this.database.imageVersions,
      async () => {
        const rows = await this.database.attempts
          .where({ stageId })
          .primaryKeys();
        await this.database.annotations.where("attemptId").anyOf(rows).delete();
        await this.database.imageVersions
          .where("attemptId")
          .anyOf(rows)
          .delete();
        await this.database.stages.delete(stageId);
        await this.database.attempts.where({ stageId }).delete();
        await this.database.checkpoints.where({ stageId }).delete();
      },
    );
  }
  async sourceFor(stageId: ID) {
    const s = await this.database.stages.get(stageId);
    if (!s) return;
    const stages = (
      await this.database.stages.where({ workflowId: s.workflowId }).toArray()
    )
      .filter((x) => x.order < s.order)
      .sort((a, b) => b.order - a.order);
    for (const stage of stages)
      if (stage.currentCheckpointId) {
        const cp = await this.database.checkpoints.get(
          stage.currentCheckpointId,
        );
        if (cp) return cp;
      }
  }
  async addAttempt(stageId: ID, sourceCheckpointId?: ID, previous?: Attempt) {
    return this.database.transaction(
      "rw",
      [
        this.database.stages,
        this.database.attempts,
        this.database.checkpoints,
        this.database.workflows,
      ],
      async () => {
        const s = await this.database.stages.get(stageId);
        if (!s) throw Error("Stage unavailable.");
        const cp = sourceCheckpointId
          ? await this.database.checkpoints.get(sourceCheckpointId)
          : undefined;
        if (sourceCheckpointId && !cp)
          throw Error(
            "Source checkpoint is unavailable. Select another approved reference.",
          );
        if (cp && cp.workflowId !== s.workflowId)
          throw Error("Source must belong to this workflow.");
        if (previous) {
          const stored = await this.database.attempts.get(previous.id);
          if (
            !stored ||
            stored.stageId !== stageId ||
            stored.workflowId !== s.workflowId
          )
            throw Error("Branch parent must belong to the target stage.");
          previous = stored;
        }
        const w = await this.database.workflows.get(s.workflowId);
        const existing = await this.database.attempts
          .where({ workflowId: s.workflowId })
          .toArray();
        const createdAt = Math.max(
          Date.now(),
          ...existing.map((a) => a.createdAt + 1),
        );
        const a: Attempt = {
          id: id(),
          stageId,
          workflowId: s.workflowId,
          createdAt,
          updatedAt: createdAt,
          sourceCheckpointId: cp?.id,
          previousAttemptId: previous?.id,
          parentIterationId: previous?.id,
          prompt: clone(previous?.prompt ?? cp?.prompt ?? emptyPrompt()),
          contract: clone(
            previous?.contract ?? cp?.contract ?? defaultContract(),
          ),
          platform: previous?.platform ?? cp?.platform ?? w?.platform ?? "",
          notes: "",
          status: "DRAFT",
          previousFailure: clone(previous?.failure),
        };
        a.prompt.version++;
        a.contract.version++;
        if (!previous && cp?.stageId !== stageId) a.prompt.objective = s.name;
        if (previous && cp) {
          const sourceStage = await this.database.stages.get(cp.stageId);
          a.retryBrief = exportRetryBrief(
            `${sourceStage?.name ?? "Unavailable stage"} / ${cp.attemptId.slice(0, 8)} — approved`,
            a.contract,
            a.prompt.objective,
            previous.failure,
          );
        }
        await this.database.attempts.add(a);
        return a;
      },
    );
  }
  /** A branch always appends a draft; no approved checkpoint is invalidated. */
  async branch(attemptId: ID, checkpointId?: ID) {
    return this.database.transaction(
      "rw",
      [
        this.database.attempts,
        this.database.checkpoints,
        this.database.stages,
        this.database.workflows,
      ],
      async () => {
        const parent = await this.database.attempts.get(attemptId);
        if (!parent) throw Error("Parent iteration unavailable.");
        const approved =
          parent.status === "APPROVED"
            ? await this.database.checkpoints.where({ attemptId }).first()
            : undefined;
        return this.addAttempt(
          parent.stageId,
          checkpointId ?? approved?.id ?? parent.sourceCheckpointId,
          parent,
        );
      },
    );
  }
  async returnToCheckpoint(checkpointId: ID, targetStageId: ID, parentId?: ID) {
    return this.database.transaction(
      "rw",
      [
        this.database.attempts,
        this.database.checkpoints,
        this.database.stages,
        this.database.workflows,
      ],
      async () => {
        const parent = parentId
          ? await this.database.attempts.get(parentId)
          : undefined;
        if (parentId && !parent) throw Error("Parent iteration unavailable.");
        const cp = await this.database.checkpoints.get(checkpointId);
        if (!cp) throw Error("Checkpoint unavailable.");
        const next = await this.addAttempt(targetStageId, checkpointId, parent);
        // Explicitly returning to a checkpoint restores that checkpoint's constraints.
        next.contract = clone(cp.contract);
        next.contract.version++;
        await this.save(next);
        return next;
      },
    );
  }
  async moveNode(stageId: ID, position: { x: number; y: number }) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
      throw Error("Invalid position.");
    if (
      !(await this.database.stages.update(stageId, {
        visualPosition: clone(position),
      }))
    )
      throw Error("Stage unavailable.");
  }
  async save(a: Attempt) {
    await this.database.transaction("rw", this.database.attempts, async () => {
      const original = await this.database.attempts.get(a.id);
      if (!original || original.status !== "DRAFT")
        throw Error(
          "Historical attempts are immutable. Create a new draft to edit.",
        );
      if (
        a.stageId !== original.stageId ||
        a.workflowId !== original.workflowId ||
        a.sourceCheckpointId !== original.sourceCheckpointId ||
        a.previousAttemptId !== original.previousAttemptId ||
        a.parentIterationId !== original.parentIterationId ||
        a.createdAt !== original.createdAt
      )
        throw Error(
          "Iteration identity and lineage cannot be rewritten. Create a branch.",
        );
      if (
        original.revisionContext &&
        JSON.stringify(a.revisionContext) !==
          JSON.stringify(original.revisionContext)
      )
        throw Error(
          "Retry context is an immutable snapshot. Edit the next direction instead.",
        );
      if (
        original.externalSource &&
        JSON.stringify(a.externalSource) !==
          JSON.stringify(original.externalSource)
      )
        throw Error("Imported provenance is an immutable snapshot.");
      if (a.status !== "DRAFT")
        throw Error("Use the approval or failure action.");
      await this.database.attempts.put({ ...clone(a), updatedAt: Date.now() });
    });
  }
  async approve(attemptId: ID) {
    return this.database.transaction(
      "rw",
      this.database.attempts,
      this.database.checkpoints,
      this.database.stages,
      async () => {
        const a = await this.database.attempts.get(attemptId);
        if (!a || a.status !== "DRAFT")
          throw Error("Only a draft can be approved.");
        if (!a.image) throw Error("Upload an output before approving.");
        const cp: Checkpoint = {
          id: id(),
          attemptId: a.id,
          stageId: a.stageId,
          workflowId: a.workflowId,
          createdAt: Date.now(),
          externalSource: clone(a.externalSource),
          prompt: clone(a.prompt),
          contract: clone(a.contract),
          image: a.image,
          platform: a.platform,
          notes: a.notes,
        };
        await this.database.checkpoints.add(cp);
        await this.database.attempts.update(a.id, {
          status: "APPROVED",
          updatedAt: Date.now(),
        });
        await this.database.stages.update(a.stageId, {
          currentCheckpointId: cp.id,
          status: "Approved",
        });
        return cp;
      },
    );
  }
  async reject(attemptId: ID, failure: FailureReport) {
    if (!failure.categories.length)
      throw Error("Select at least one failure category.");
    await this.database.transaction(
      "rw",
      this.database.attempts,
      this.database.stages,
      async () => {
        const a = await this.database.attempts.get(attemptId);
        if (!a || a.status !== "DRAFT")
          throw Error("Only a draft can be rejected.");
        await this.database.attempts.update(attemptId, {
          status: "REJECTED",
          failure: clone(failure),
          updatedAt: Date.now(),
        });
        await this.database.stages.update(a.stageId, {
          status: "Needs Revision",
        });
      },
    );
  }
  async ensureImageVersion(attemptId: ID) {
    const a = await this.database.attempts.get(attemptId);
    if (!a?.image) throw Error("Upload and save an output before annotating.");
    const key = await imageVersionKey(a.id, a.image);
    return this.database.transaction(
      "rw",
      this.database.attempts,
      this.database.imageVersions,
      async () => {
        const current = await this.database.attempts.get(a.id);
        if (!current || current.updatedAt !== a.updatedAt)
          throw Error(
            "The image changed. Reopen its review before annotating.",
          );
        const existing = await this.database.imageVersions.get(key);
        if (existing) return existing;
        const v: ImageVersion = {
          id: key,
          attemptId,
          workflowId: a.workflowId,
          image: a.image!,
          createdAt: Date.now(),
        };
        await this.database.imageVersions.add(v);
        return v;
      },
    );
  }
  async putAnnotation(
    input: Omit<
      ImageAnnotation,
      "id" | "createdAt" | "updatedAt" | "workflowId" | "attemptId"
    > & { id?: ID; updatedAt?: number },
  ) {
    if (
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.y) ||
      input.x < 0 ||
      input.x > 1 ||
      input.y < 0 ||
      input.y > 1
    )
      throw Error("Annotation must lie within the image.");
    if (!annotationCategories.includes(input.category))
      throw Error("Choose a failure category.");
    return this.database.transaction(
      "rw",
      this.database.annotations,
      this.database.imageVersions,
      this.database.attempts,
      async () => {
        const v = await this.database.imageVersions.get(input.imageVersionId);
        if (!v || !(await this.database.attempts.get(v.attemptId)))
          throw Error("Image version unavailable.");
        const previous = input.id
          ? await this.database.annotations.get(input.id)
          : undefined;
        if (input.id && (!previous || previous.imageVersionId !== v.id))
          throw Error("Annotation version cannot be changed.");
        if (previous && input.updatedAt !== previous.updatedAt)
          throw Error(
            "This annotation changed in another view. Your edits are still here. Copy your note, then close the editor and select the pin again to review the saved version.",
          );
        const a: ImageAnnotation = {
          ...input,
          id: previous?.id ?? id(),
          attemptId: v.attemptId,
          workflowId: v.workflowId,
          createdAt: previous?.createdAt ?? Date.now(),
          updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
        };
        await this.database.annotations.put(a);
        return a;
      },
    );
  }
  async removeAnnotation(annotationId: ID, expectedUpdatedAt: number) {
    await this.database.transaction(
      "rw",
      this.database.annotations,
      async () => {
        const current = await this.database.annotations.get(annotationId);
        if (!current) return;
        if (current.updatedAt !== expectedUpdatedAt)
          throw Error(
            "This annotation changed in another view. Close the editor and select the pin again before removing it.",
          );
        await this.database.annotations.delete(annotationId);
      },
    );
  }
  async retry(attemptId: ID, nextDirection?: string) {
    const a = await this.database.attempts.get(attemptId);
    if (!a || a.status !== "REJECTED")
      throw Error("Select a rejected attempt.");
    if (!a.sourceCheckpointId)
      throw Error(
        "This attempt has no approved source. Select an approved checkpoint.",
      );
    const savedDirection = await this.database.settings.get(
      "reviewDirection:" + attemptId,
    );
    const versionId = a.image
      ? await (Dexie.currentTransaction
          ? Dexie.waitFor(imageVersionKey(a.id, a.image))
          : imageVersionKey(a.id, a.image))
      : undefined;
    return this.database.transaction(
      "rw",
      [
        this.database.attempts,
        this.database.checkpoints,
        this.database.stages,
        this.database.workflows,
        this.database.annotations,
      ],
      async () => {
        const pins = versionId
          ? await this.database.annotations
              .where({ imageVersionId: versionId })
              .sortBy("createdAt")
          : [];
        const next = await this.addAttempt(a.stageId, a.sourceCheckpointId, a);
        next.revisionContext = {
          parentIterationId: a.id,
          sourceCheckpointId: a.sourceCheckpointId!,
          imageVersionId: versionId,
          annotations: clone(pins),
          failure: clone(a.failure),
          createdAt: Date.now(),
        };
        next.revisionDirection =
          nextDirection ?? savedDirection?.value ?? a.revisionDirection ?? "";
        next.retryBrief = compileRecovery(next, "Approved source reference");
        await this.save(next);
        return next;
      },
    );
  }
  async reviseCheckpoint(checkpointId: ID) {
    return this.database.transaction(
      "rw",
      [
        this.database.stages,
        this.database.attempts,
        this.database.checkpoints,
        this.database.workflows,
      ],
      async () => {
        const cp = await this.database.checkpoints.get(checkpointId);
        if (!cp) throw Error("Checkpoint unavailable.");
        const parent = await this.database.attempts.get(cp.attemptId);
        const draft = await this.addAttempt(cp.stageId, cp.id, parent);
        draft.image = cp.image;
        draft.notes = cp.notes;
        await this.save(draft);
        return draft;
      },
    );
  }
  async restore(checkpointId: ID, targetStageId?: ID) {
    const cp = await this.database.checkpoints.get(checkpointId);
    if (!cp) throw Error("Checkpoint unavailable.");
    return this.addAttempt(targetStageId ?? cp.stageId, cp.id);
  }
}
export const repo = new Repository(db);
export async function validateImage(file: File): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("Use a PNG, JPEG, or WebP image.");
  if (file.size > 15 * 1024 * 1024)
    throw Error("Image exceeds the 15 MB limit.");
  if (!file.size) throw Error("This file is empty.");
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
  } catch {
    throw Error("This image could not be decoded. Choose a valid image file.");
  }
  return file;
}
