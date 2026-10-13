import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  PreserveDB,
  Repository,
  compileRecovery,
  imageVersionKey,
  normalizePoint,
  resolveReference,
  type Stage,
} from "./domain";
let db: PreserveDB, repo: Repository, stages: Stage[];
beforeEach(async () => {
  db = new PreserveDB("review-" + crypto.randomUUID());
  repo = new Repository(db);
  const w = await repo.createWorkflow({
    name: "Review",
    description: "",
    platform: "Krea manual",
    objective: "Campaign",
  });
  stages = await db.stages.where({ workflowId: w.id }).sortBy("order");
});
afterEach(async () => {
  await db.delete();
});
async function fixture() {
  const a = await repo.addAttempt(stages[1].id);
  a.image = new Blob(["source"], { type: "image/png" });
  await repo.save(a);
  const cp = await repo.approve(a.id);
  const failed = await repo.addAttempt(stages[2].id, cp.id);
  failed.image = new Blob(["bad logo"], { type: "image/png" });
  failed.prompt.subject = "A model holding the original product";
  await repo.save(failed);
  await repo.reject(failed.id, {
    categories: ["Product fidelity"],
    explanation: "Changed logo",
    createdAt: 1,
  });
  return { cp, failed: (await db.attempts.get(failed.id))! };
}
it("resolves the stored checkpoint, never the latest output or stage order", async () => {
  const { cp, failed } = await fixture();
  const newer = await repo.addAttempt(stages[1].id);
  newer.image = new Blob(["new"]);
  await repo.save(newer);
  const newerCp = await repo.approve(newer.id);
  expect(resolveReference(failed, [newerCp, cp])?.id).toBe(cp.id);
  expect(resolveReference(failed, [newerCp])).toBeUndefined();
});
it("normalizes resized and zoomed coordinates and rejects invalid dimensions", () => {
  expect(normalizePoint(75, 50, 300, 200)).toEqual({ x: 0.25, y: 0.25 });
  expect(normalizePoint(150, 100, 600, 400)).toEqual({ x: 0.25, y: 0.25 });
  expect(normalizePoint(-3, 999, 300, 200)).toEqual({ x: 0, y: 1 });
  expect(() => normalizePoint(0, 0, 0, 2)).toThrow();
});
it("persists editable annotations separately from immutable history, with version identity", async () => {
  const { failed } = await fixture();
  const version = await repo.ensureImageVersion(failed.id);
  const pin = await repo.putAnnotation({
    imageVersionId: version.id,
    x: 0.25,
    y: 0.4,
    note: "The logo changed.",
    category: "Logo / Typography",
  });
  db.close();
  await db.open();
  expect(await db.annotations.get(pin.id)).toEqual(pin);
  expect(await db.attempts.get(failed.id)).toEqual(failed);
  const edited = await repo.putAnnotation({
    ...pin,
    note: "Keep the original typography.",
  });
  expect(edited.id).toBe(pin.id);
  await repo.removeAnnotation(pin.id, edited.updatedAt);
  expect(await db.annotations.count()).toBe(0);
  expect(await db.imageVersions.get(version.id)).toBeDefined();
});
it("retains the exact old image and pins when a draft output is replaced", async () => {
  const a = await repo.addAttempt(stages[0].id);
  a.image = new Blob(["first"]);
  await repo.save(a);
  const old = await repo.ensureImageVersion(a.id);
  await repo.putAnnotation({
    imageVersionId: old.id,
    x: 0.2,
    y: 0.3,
    note: "Original",
    category: "Other",
  });
  a.image = new Blob(["second"]);
  await repo.save(a);
  const next = await repo.ensureImageVersion(a.id);
  expect(next.id).not.toBe(old.id);
  expect(await (await db.imageVersions.get(old.id))!.image.text()).toBe(
    "first",
  );
  expect(await db.annotations.where({ imageVersionId: next.id }).count()).toBe(
    0,
  );
});
it("creates an annotated retry with deterministic prompt and full provenance", async () => {
  const { failed, cp } = await fixture();
  const v = await repo.ensureImageVersion(failed.id);
  await repo.putAnnotation({
    imageVersionId: v.id,
    x: 0.5,
    y: 0.6,
    note: "The logo changed.",
    category: "Logo / Typography",
  });
  const before = await db.checkpoints.get(cp.id);
  const next = await repo.retry(
    failed.id,
    "Preserve pose. Correct only the logo.",
  );
  expect(next.sourceCheckpointId).toBe(cp.id);
  expect(next.parentIterationId).toBe(failed.id);
  expect(next.revisionContext?.annotations).toHaveLength(1);
  expect(next.image).toBeUndefined();
  expect(next.prompt.subject).toBe(failed.prompt.subject);
  expect(next.contract.attributes).toEqual(failed.contract.attributes);
  expect(await db.attempts.get(failed.id)).toEqual(failed);
  expect(await db.checkpoints.get(cp.id)).toEqual(before);
  const full = compileRecovery(next, "Model Shot");
  const short = compileRecovery(next, "Model Shot", [], true);
  for (const title of [
    "SOURCE REFERENCE",
    "CURRENT OBJECTIVE",
    "WHAT MUST STAY THE SAME",
    "WHAT SHOULD CHANGE",
    "WHAT FAILED PREVIOUSLY",
    "ANNOTATION NOTES",
    "NEXT GENERATION INSTRUCTIONS",
  ])
    expect(full).toContain(title);
  expect(full).toContain("The logo changed.");
  expect(full).toContain(v.id);
  expect(short).not.toContain(v.id);
  expect(short).toContain("Correct only the logo");
  expect(compileRecovery(next, "Model Shot")).toBe(full);
  await db.annotations.clear();
  expect(compileRecovery(next, "Model Shot")).toContain("The logo changed.");
  await expect(
    repo.save({ ...failed, contract: { version: 99, attributes: [] } }),
  ).rejects.toThrow("immutable");
});
it("rejects missing sources and invalid or reassigned pins", async () => {
  const { failed, cp } = await fixture();
  const v = await repo.ensureImageVersion(failed.id);
  await expect(
    repo.putAnnotation({
      imageVersionId: v.id,
      x: 1.2,
      y: 0,
      note: "",
      category: "Other",
    }),
  ).rejects.toThrow();
  await db.checkpoints.delete(cp.id);
  await expect(repo.retry(failed.id)).rejects.toThrow("unavailable");
  expect(await db.attempts.count()).toBe(2);
  expect(await imageVersionKey(failed.id, failed.image!)).toBe(v.id);
});
it("upgrades a populated v1 database without rewriting records or blobs", async () => {
  const name = "migration-" + crypto.randomUUID();
  const old = new Dexie(name);
  old.version(1).stores({
    workflows: "id,createdAt",
    stages: "id,workflowId,order",
    attempts: "id,stageId,workflowId,sourceCheckpointId,previousAttemptId",
    checkpoints: "id,attemptId,stageId,workflowId",
    settings: "key",
  });
  await old.open();
  const row = {
    id: "legacy",
    stageId: "s",
    workflowId: "w",
    sourceCheckpointId: "kept",
    image: new Blob(["original bytes"]),
    prompt: { subject: "Original" },
  };
  await old.table("attempts").add(row);
  old.close();
  const upgraded = new PreserveDB(name);
  try {
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    const saved = await upgraded.attempts.get("legacy");
    expect(saved?.sourceCheckpointId).toBe("kept");
    expect(saved?.prompt.subject).toBe("Original");
    expect(await saved?.image?.text()).toBe("original bytes");
    expect(await upgraded.annotations.count()).toBe(0);
    expect(await upgraded.imageVersions.count()).toBe(0);
  } finally {
    await upgraded.delete();
  }
});
it("honors saved review direction and protects retry context after creation", async () => {
  const { failed } = await fixture();
  await db.settings.put({
    key: "reviewDirection:" + failed.id,
    value: "Restore the original logo.",
  });
  const retry = await repo.retry(failed.id);
  expect(retry.revisionDirection).toBe("Restore the original logo.");
  retry.revisionContext!.sourceCheckpointId = "changed";
  await expect(repo.save(retry)).rejects.toThrow("immutable snapshot");
  expect(
    (await db.attempts.get(retry.id))!.revisionContext!.sourceCheckpointId,
  ).toBe(failed.sourceCheckpointId);
});

it("rejects stale annotation edits and deletions without losing either saved or pending notes", async () => {
  const { failed } = await fixture();
  const version = await repo.ensureImageVersion(failed.id);
  const original = await repo.putAnnotation({
    imageVersionId: version.id,
    x: 0.2,
    y: 0.4,
    category: "Logo / Typography",
    note: "Original",
  });
  const current = await repo.putAnnotation({
    ...original,
    note: "Saved in another view",
  });
  expect(current.updatedAt).toBeGreaterThan(original.updatedAt);
  const pending = { ...original, note: "Unsaved local note" };
  await expect(repo.putAnnotation(pending)).rejects.toThrow(
    "changed in another view",
  );
  expect(pending.note).toBe("Unsaved local note");
  await expect(
    repo.removeAnnotation(original.id, original.updatedAt),
  ).rejects.toThrow("changed in another view");
  expect(await db.annotations.get(original.id)).toEqual(current);
  await repo.removeAnnotation(current.id, current.updatedAt);
  await expect(
    repo.putAnnotation({ ...current, note: "Do not resurrect" }),
  ).rejects.toThrow();
  expect(await db.annotations.get(current.id)).toBeUndefined();
});
it("keeps an enclosing transaction alive while hashing retry image provenance", async () => {
  const { failed } = await fixture();
  const result = await db.transaction(
    "rw",
    [
      db.attempts,
      db.checkpoints,
      db.stages,
      db.workflows,
      db.settings,
      db.annotations,
    ],
    async () => {
      const next = await repo.retry(failed.id);
      await db.settings.put({ key: "nested-retry-completed", value: next.id });
      return next;
    },
  );
  expect((await db.settings.get("nested-retry-completed"))?.value).toBe(
    result.id,
  );
  expect(result.revisionContext?.imageVersionId).toBe(
    await imageVersionKey(failed.id, failed.image!),
  );
});
