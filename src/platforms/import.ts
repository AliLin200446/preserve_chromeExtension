import {
  Repository,
  type PreserveDB,
  type Attempt,
  compileRecovery,
} from "../domain";
import type {
  CanvasNode,
  Handoff,
  PlatformProvenance,
  RemoteCanvas,
} from "./types";
export async function blobHash(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function imageNode(node: CanvasNode) {
  return [
    "image",
    "static_image",
    "staticImageBlock",
    "resultImageBlock",
    "emptyImageBlock",
    "inpaintImageBlock",
    "outpaintImageBlock",
  ].includes(node.type);
}
export async function importNode(
  database: PreserveDB,
  input: {
    workspaceId: string;
    projectName: string;
    canvas: RemoteCanvas;
    node: CanvasNode;
    blob: Blob;
    stageId: string;
    draftId?: string;
    expectedUpdatedAt?: number;
    checkpointId?: string;
    approve: boolean;
  },
) {
  if (!imageNode(input.node))
    throw Error("This node type cannot be imported as an image checkpoint.");
  if (!input.canvas.nodes.some((n) => n.id === input.node.id))
    throw Error("Node is not part of this canvas.");
  if (
    !input.blob.size ||
    input.blob.size > 15 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(input.blob.type)
  )
    throw Error("A supported image asset up to 15 MB is required.");
  const hash = await blobHash(input.blob);
  const repository = new Repository(database);
  const source: PlatformProvenance = {
    platform: "FLORA",
    workspaceId: input.workspaceId,
    projectId: input.canvas.projectId,
    projectName: input.projectName,
    nodeId: input.node.id,
    nodeType: input.node.type,
    assetId: input.node.assetId,
    model: input.node.model,
    prompt: input.node.prompt,
    importedAt: Date.now(),
    imageHash: hash,
    canvasEdges: structuredClone(
      input.canvas.edges.filter(
        (e) => e.source === input.node.id || e.target === input.node.id,
      ),
    ),
    sourceNodeIds: input.canvas.edges
      .filter((e) => e.target === input.node.id)
      .map((e) => e.source),
    inputs: structuredClone(input.node.inputs),
    output: structuredClone(input.node.output),
  };
  return database.transaction(
    "rw",
    [
      database.attempts,
      database.checkpoints,
      database.stages,
      database.workflows,
    ],
    async () => {
      const stage = await database.stages.get(input.stageId);
      if (!stage) throw Error("Destination stage is unavailable.");
      const existing = await database.attempts
        .where({ stageId: input.stageId })
        .toArray();
      if (
        existing.some(
          (a) =>
            a.externalSource?.workspaceId === source.workspaceId &&
            a.externalSource?.projectId === source.projectId &&
            a.externalSource?.nodeId === source.nodeId &&
            a.externalSource?.imageHash === hash,
        )
      )
        throw Error(
          "This output is already imported into this stage. Open its existing iteration.",
        );
      let a: Attempt;
      if (input.draftId) {
        const current = await database.attempts.get(input.draftId);
        if (
          !current ||
          current.stageId !== input.stageId ||
          current.status !== "DRAFT" ||
          current.image ||
          current.updatedAt !== input.expectedUpdatedAt
        )
          throw Error(
            "Destination draft changed. Select an empty draft again.",
          );
        a = current;
      } else
        a = await repository.addAttempt(
          input.stageId,
          input.checkpointId || undefined,
        );
      a.image = input.blob;
      a.externalSource = source;
      a.platform = "FLORA";
      if (input.node.prompt) a.prompt.notes = input.node.prompt;
      await repository.save(a);
      if (input.approve) await repository.approve(a.id);
      return (await database.attempts.get(a.id))!;
    },
  );
}
export function prepareHandoff(
  attempt: Attempt,
  target: { workspaceId: string; projectId: string; projectName: string },
  source: PlatformProvenance | undefined,
  referenceLabel: string,
): Handoff {
  return {
    ...target,
    mode:
      source?.workspaceId === target.workspaceId &&
      source.projectId === target.projectId
        ? "node"
        : "manual",
    referenceNodeId: source?.nodeId,
    referenceLabel,
    prompt: compileRecovery(attempt, referenceLabel, [], true),
    idempotencyKey: crypto.randomUUID(),
  };
}
