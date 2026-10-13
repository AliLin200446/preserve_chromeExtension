import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PreserveDB,
  Repository,
  emptyPrompt,
  defaultContract,
  exportPrompt,
  exportRetryBrief,
  type Attempt,
  type Stage,
} from "./domain";
let database: PreserveDB;
let repository: Repository;
let stages: Stage[];
beforeEach(async () => {
  database = new PreserveDB(`test-${crypto.randomUUID()}`);
  repository = new Repository(database);
  const w = await repository.createWorkflow({
    name: "Campaign",
    description: "Local",
    platform: "Manual",
    objective: "Ad",
  });
  stages = await database.stages.where({ workflowId: w.id }).sortBy("order");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.delete();
});
async function approved(stage = stages[0]) {
  const a = await repository.addAttempt(stage.id);
  a.image = new Blob(["test image"], { type: "image/png" });
  a.prompt.subject = "Original bottle";
  a.contract.attributes[0].notes = "Exact shape";
  await repository.save(a);
  return repository.approve(a.id);
}
async function rejected() {
  const cp = await approved();
  const a = await repository.addAttempt(stages[1].id, cp.id);
  a.prompt.objective = "A model holding the bottle";
  await repository.save(a);
  await repository.reject(a.id, {
    categories: ["Product fidelity"],
    explanation: "Changed logo",
    createdAt: Date.now(),
  });
  return { cp, a };
}
describe("workflow and stage management", () => {
  it("creates a persistent workflow and remembers it", async () => {
    const w = (await database.workflows.toArray())[0];
    expect(w.name).toBe("Campaign");
    expect(w.createdAt).toBeGreaterThan(0);
    expect((await database.settings.get("activeWorkflow"))?.value).toBe(w.id);
    expect(stages).toHaveLength(4);
  });
  it("creates and reorders arbitrary stages", async () => {
    const s = await repository.addStage(stages[0].workflowId, "Extra");
    await repository.reorder(s.workflowId, [s.id, ...stages.map((s) => s.id)]);
    expect((await database.stages.get(s.id))?.order).toBe(0);
    expect((await database.stages.get(stages[0].id))?.order).toBe(1);
  });
  it("rejects invalid reorder without partially changing order", async () => {
    await expect(
      repository.reorder(stages[0].workflowId, [stages[0].id]),
    ).rejects.toThrow("Invalid");
    expect((await database.stages.get(stages[0].id))?.order).toBe(0);
  });
});
describe("attempts and immutable checkpoints", () => {
  it("adds a draft with a stable ID and timestamp", async () => {
    const a = await repository.addAttempt(stages[0].id);
    expect(a.status).toBe("DRAFT");
    expect(await database.attempts.get(a.id)).toEqual(a);
  });
  it("approves an image as current checkpoint and retains historical approvals", async () => {
    const first = await approved();
    const second = await approved();
    expect((await database.stages.get(stages[0].id))?.currentCheckpointId).toBe(
      second.id,
    );
    expect(await database.checkpoints.count()).toBe(2);
    expect((await database.attempts.get(first.attemptId))?.status).toBe(
      "APPROVED",
    );
  });
  it("requires output before approval", async () => {
    const a = await repository.addAttempt(stages[0].id);
    await expect(repository.approve(a.id)).rejects.toThrow("Upload");
    expect(await database.checkpoints.count()).toBe(0);
  });
  it("rejects an attempt with manual failure categories", async () => {
    const { a } = await rejected();
    expect((await database.attempts.get(a.id))?.failure?.categories).toEqual([
      "Product fidelity",
    ]);
    expect((await database.attempts.get(a.id))?.status).toBe("REJECTED");
  });
  it("creates a retry retaining the approved source and real previous-attempt relation", async () => {
    const { cp, a } = await rejected();
    const retry = await repository.retry(a.id);
    expect(retry.sourceCheckpointId).toBe(cp.id);
    expect(retry.previousAttemptId).toBe(a.id);
    expect(retry.previousFailure?.explanation).toBe("Changed logo");
    expect(retry.status).toBe("DRAFT");
    expect(retry.image).toBeUndefined();
    expect(retry.retryBrief).toContain("Changed logo");
  });
  it("preserves historical prompt snapshots when retry is edited", async () => {
    const { cp, a } = await rejected();
    const retry = await repository.retry(a.id);
    retry.prompt.subject = "Edited subject";
    await repository.save(retry);
    expect((await database.attempts.get(a.id))?.prompt.subject).toBe(
      "Original bottle",
    );
    expect((await database.checkpoints.get(cp.id))?.prompt.subject).toBe(
      "Original bottle",
    );
  });
  it("preserves reference contracts with independently versioned snapshots", async () => {
    const { cp, a } = await rejected();
    const retry = await repository.retry(a.id);
    retry.contract.attributes[0].notes = "Different shape";
    await repository.save(retry);
    expect(
      (await database.checkpoints.get(cp.id))?.contract.attributes[0].notes,
    ).toBe("Exact shape");
    expect(
      (await database.attempts.get(a.id))?.contract.attributes[0].notes,
    ).toBe("Exact shape");
    expect(retry.contract.version).toBeGreaterThan(cp.contract.version);
  });
  it("refuses mutation of approved or rejected attempts", async () => {
    const { cp, a } = await rejected();
    await expect(
      repository.save((await database.attempts.get(cp.attemptId)) as Attempt),
    ).rejects.toThrow("immutable");
    await expect(
      repository.save((await database.attempts.get(a.id)) as Attempt),
    ).rejects.toThrow("immutable");
  });
  it("finds the closest preceding approved stage", async () => {
    await approved();
    const cp = await approved(stages[1]);
    expect((await repository.sourceFor(stages[3].id))?.id).toBe(cp.id);
    expect(await repository.sourceFor(stages[0].id)).toBeUndefined();
  });
  it("restores without deleting or changing history", async () => {
    const cp = await approved();
    const later = await approved();
    const a = await repository.restore(cp.id);
    expect(a.sourceCheckpointId).toBe(cp.id);
    expect(a.status).toBe("DRAFT");
    expect(await database.attempts.count()).toBe(3);
    expect(await database.checkpoints.count()).toBe(2);
    expect((await database.stages.get(stages[0].id))?.currentCheckpointId).toBe(
      later.id,
    );
  });
  it("handles deleted sources without inventing lineage", async () => {
    const { cp, a } = await rejected();
    await repository.deleteStage(stages[0].id);
    expect((await database.attempts.get(a.id))?.sourceCheckpointId).toBe(cp.id);
    await expect(repository.retry(a.id)).rejects.toThrow("unavailable");
  });
  it("does not silently choose a different source for a source-less retry", async () => {
    const a = await repository.addAttempt(stages[0].id);
    await repository.reject(a.id, {
      categories: ["Other"],
      explanation: "",
      createdAt: Date.now(),
    });
    await expect(repository.retry(a.id)).rejects.toThrow("no approved source");
  });
  it("does not permit cross-workflow reference linkage", async () => {
    const cp = await approved();
    const w = await repository.createWorkflow({
      name: "Other",
      description: "",
      platform: "",
      objective: "",
    });
    const s = (await database.stages.where({ workflowId: w.id }).toArray())[0];
    await expect(repository.addAttempt(s.id, cp.id)).rejects.toThrow("belong");
  });
});
describe("deterministic exports", () => {
  it("generates structured and concise prompts from actual fields", () => {
    const p = emptyPrompt();
    p.subject = "Serum bottle";
    p.negative = "No distorted label";
    const c = defaultContract();
    const output = exportPrompt(p, c);
    expect(output).toContain("SUBJECT:\nSerum bottle");
    expect(output).toContain("NEGATIVE PROMPT:\nNo distorted label");
    expect(output).toContain("PRESERVE:\nProduct geometry");
    expect(exportPrompt(p, c, true)).not.toContain("\n");
  });
  it("exports a retry brief including source, objective, requirements and failures", () => {
    const output = exportRetryBrief(
      "Stage 02",
      defaultContract(),
      "Cinematic video",
      {
        categories: ["Character identity"],
        explanation: "Face drift",
        createdAt: 1,
      },
    );
    for (const value of [
      "SOURCE:\nStage 02",
      "PRESERVE:\nProduct geometry",
      "Cinematic video",
      "Face drift",
      "Character identity",
      "NEXT ATTEMPT:",
    ])
      expect(output).toContain(value);
  });
});

describe("snapshot restore and creation order", () => {
  it("keeps restored prompt fields intact", async () => {
    const a = await repository.addAttempt(stages[0].id);
    a.image = new Blob(["output"]);
    a.prompt.objective = "User-defined lighting objective";
    await repository.save(a);
    const cp = await repository.approve(a.id);
    const restored = await repository.restore(cp.id);
    expect(restored.prompt.objective).toBe("User-defined lighting objective");
  });
  it("gives concurrent attempts a stable order even within the same millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const attempts = await Promise.all([
      repository.addAttempt(stages[0].id),
      repository.addAttempt(stages[0].id),
      repository.addAttempt(stages[0].id),
    ]);
    expect(new Set(attempts.map((a) => a.createdAt)).size).toBe(3);
  });
});

describe("checkpoint contract revision", () => {
  it("reuses the output in a new draft while preserving prior approval", async () => {
    const cp = await approved();
    const revision = await repository.reviseCheckpoint(cp.id);
    expect(revision.image?.size).toBe(cp.image.size);
    revision.contract.attributes[0].mode = "ADAPT";
    await repository.save(revision);
    expect(
      (await database.checkpoints.get(cp.id))?.contract.attributes[0].mode,
    ).toBe("PRESERVE");
    expect((await database.stages.get(cp.stageId))?.currentCheckpointId).toBe(
      cp.id,
    );
    const next = await repository.approve(revision.id);
    expect(next.id).not.toBe(cp.id);
    expect(await database.checkpoints.count()).toBe(2);
  });
});

describe("visual decision graph", () => {
  it("keeps the entire four-stage rejection and checkpoint-return history across reopen", async () => {
    const one = await approved(stages[0]);
    const a2 = await repository.addAttempt(stages[1].id, one.id);
    a2.image = new Blob(["model"], { type: "image/png" });
    a2.contract.knownFailurePoints = "Check logo typography";
    await repository.save(a2);
    const two = await repository.approve(a2.id);
    const a3 = await repository.addAttempt(stages[2].id, two.id);
    a3.prompt.subject = "First direction";
    a3.image = new Blob(["failed"], { type: "image/png" });
    a3.notes = "Product label distorted.";
    await repository.save(a3);
    await repository.reject(a3.id, {
      categories: ["Product fidelity"],
      explanation: "Product label distorted.",
      createdAt: Date.now(),
    });
    const original = await database.attempts.get(a3.id);
    const next = await repository.returnToCheckpoint(
      two.id,
      stages[2].id,
      a3.id,
    );
    expect(next.parentIterationId).toBe(a3.id);
    expect(next.sourceCheckpointId).toBe(two.id);
    expect(next.contract.knownFailurePoints).toBe("Check logo typography");
    next.prompt.subject = "Second direction";
    next.image = new Blob(["better"], { type: "image/png" });
    await repository.save(next);
    const three = await repository.approve(next.id);
    const checkpointBefore = await database.checkpoints.toArray();
    await repository.moveNode(stages[1].id, { x: 811, y: -95 });
    expect(await database.attempts.get(a3.id)).toEqual(original);
    expect(await database.checkpoints.toArray()).toEqual(checkpointBefore);
    const branch2 = await repository.branch(a2.id);
    expect(branch2.parentIterationId).toBe(a2.id);
    expect((await database.stages.get(stages[1].id))?.currentCheckpointId).toBe(
      two.id,
    );
    expect((await database.stages.get(stages[2].id))?.currentCheckpointId).toBe(
      three.id,
    );
    database.close();
    await database.open();
    expect((await database.attempts.get(a3.id))?.prompt.subject).toBe(
      "First direction",
    );
    expect((await database.attempts.get(next.id))?.prompt.subject).toBe(
      "Second direction",
    );
    expect((await database.attempts.get(a3.id))?.status).toBe("REJECTED");
    expect((await database.attempts.get(next.id))?.status).toBe("APPROVED");
    expect((await database.stages.get(stages[1].id))?.visualPosition).toEqual({
      x: 811,
      y: -95,
    });
  });
  it("rejects lineage rewrites and incompatible branch parents", async () => {
    const a = await repository.addAttempt(stages[0].id);
    await expect(
      repository.save({ ...a, stageId: stages[1].id }),
    ).rejects.toThrow("lineage");
    await expect(
      repository.addAttempt(stages[1].id, undefined, a),
    ).rejects.toThrow("parent");
    await expect(
      repository.moveNode(stages[0].id, { x: NaN, y: 0 }),
    ).rejects.toThrow("position");
  });
});
