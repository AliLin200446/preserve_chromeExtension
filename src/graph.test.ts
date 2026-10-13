import { describe, expect, it } from "vitest";
import { buildAttemptLinks, buildWorkflowGraph } from "./graph";
import {
  defaultContract,
  emptyPrompt,
  type Attempt,
  type Checkpoint,
  type Stage,
} from "./domain";
const stages: Stage[] = [
  {
    id: "s1",
    workflowId: "w",
    name: "Product",
    order: 0,
    status: "Approved",
    currentCheckpointId: "cp1",
  },
  {
    id: "s2",
    workflowId: "w",
    name: "Portrait",
    order: 1,
    status: "Approved",
    currentCheckpointId: "cp2",
  },
  {
    id: "s3",
    workflowId: "w",
    name: "Advertisement",
    order: 2,
    status: "Needs Revision",
  },
];
const attempt = (
  id: string,
  stageId: string,
  createdAt: number,
  sourceCheckpointId?: string,
): Attempt => ({
  id,
  stageId,
  workflowId: "w",
  createdAt,
  updatedAt: createdAt,
  prompt: emptyPrompt(),
  contract: defaultContract(),
  platform: "Manual",
  notes: "",
  status: "DRAFT",
  sourceCheckpointId,
});
const a1 = { ...attempt("a1", "s1", 1), status: "APPROVED" as const };
const a2 = { ...attempt("a2", "s2", 2, "cp1"), status: "APPROVED" as const };
const failed = {
  ...attempt("failed", "s3", 3, "cp1"),
  status: "REJECTED" as const,
};
const retry = {
  ...attempt("retry", "s3", 4, "cp1"),
  previousAttemptId: "failed",
};
const checkpoint = (id: string, a: Attempt): Checkpoint => ({
  id,
  attemptId: a.id,
  stageId: a.stageId,
  workflowId: a.workflowId,
  createdAt: a.createdAt,
  image: new Blob(["image"]),
  prompt: a.prompt,
  contract: a.contract,
  platform: "Manual",
  notes: "",
});
const cps = [checkpoint("cp1", a1), checkpoint("cp2", a2)];
const attempts = [a1, a2, failed, retry];
describe("read-only workflow graph", () => {
  it("renders exactly one node per stage in stored order, not one per iteration", () => {
    const g = buildWorkflowGraph([...stages].reverse(), attempts, cps);
    expect(g.nodes.map((n) => n.stage.id)).toEqual(["s1", "s2", "s3"]);
    expect(g.nodes[2].iterations).toHaveLength(2);
    expect(g.edges.filter((e) => e.kind === "order")).toHaveLength(2);
  });
  it("never invents a reference from stage order", () => {
    const g = buildWorkflowGraph(stages, [], cps);
    expect(g.edges.filter((e) => e.kind === "reference")).toHaveLength(0);
    expect(g.nodes[2].source).toBeUndefined();
  });
  it("follows an explicitly selected earlier checkpoint instead of the nearest predecessor", () => {
    const g = buildWorkflowGraph(stages, attempts, cps, "s3", "retry");
    expect(g.nodes[2].source?.id).toBe("cp1");
    expect(
      g.edges.find((e) => e.kind === "reference" && e.target === "s3")?.source,
    ).toBe("s1");
    expect(
      g.edges.some(
        (e) => e.kind === "reference" && e.source === "s2" && e.target === "s3",
      ),
    ).toBe(false);
  });
  it("never promotes a rejected latest output to the approved checkpoint", () => {
    const rejected = {
      ...attempt("new-failure", "s2", 6, "cp1"),
      status: "REJECTED" as const,
    };
    const g = buildWorkflowGraph(stages, [...attempts, rejected], cps);
    expect(g.nodes[1].latest?.id).toBe("new-failure");
    expect(g.nodes[1].output?.attemptId).toBe("a2");
    expect(g.nodes[2].output).toBeUndefined();
  });
  it("keeps historical checkpoint relationships when a new current reference is approved", () => {
    const newCp = checkpoint("cp3", attempt("new-approved", "s1", 7));
    const g = buildWorkflowGraph(
      [{ ...stages[0], currentCheckpointId: "cp3" }, ...stages.slice(1)],
      attempts,
      [...cps, newCp],
    );
    expect(g.nodes[0].output?.id).toBe("cp3");
    expect(g.nodes[2].source?.id).toBe("cp1");
  });
  it("groups reference branches without manufacturing retry parents", () => {
    const g = buildWorkflowGraph(stages, attempts, cps);
    expect(
      g.edges.find((e) => e.checkpointId === "cp1" && e.target === "s3")
        ?.attemptIds,
    ).toEqual(["failed", "retry"]);
    const links = buildAttemptLinks(attempts, cps, "retry");
    expect(links.filter((l) => l.kind === "retry")).toEqual([
      {
        id: "retry:retry",
        kind: "retry",
        sourceId: "failed",
        targetId: "retry",
        available: true,
        selected: true,
      },
    ]);
  });
  it("marks missing sources and does not draw a phantom edge", () => {
    const g = buildWorkflowGraph(
      stages,
      attempts,
      cps.filter((c) => c.id !== "cp1"),
    );
    expect(g.nodes[2].missingSource).toBe(true);
    expect(
      g.edges.some((e) => e.kind === "reference" && e.target === "s3"),
    ).toBe(false);
    expect(
      buildAttemptLinks(attempts, []).find(
        (l) => l.targetId === "retry" && l.kind === "reference",
      )?.available,
    ).toBe(false);
  });
  it("highlights the chosen iteration source even if a later iteration used another source", () => {
    const later = attempt("later", "s3", 8, "cp2");
    const g = buildWorkflowGraph(
      stages,
      [...attempts, later],
      cps,
      "s3",
      "failed",
    );
    expect(g.nodes[2].latest?.id).toBe("later");
    expect(g.nodes[2].source?.id).toBe("cp1");
    expect(
      g.edges.find((e) => e.checkpointId === "cp1" && e.target === "s3")
        ?.highlighted,
    ).toBe(true);
    expect(
      g.edges.find((e) => e.checkpointId === "cp2" && e.target === "s3")
        ?.highlighted,
    ).toBe(false);
  });
  it("represents a real same-stage restore without altering stage order", () => {
    const restored = attempt("restored", "s1", 9, "cp1");
    const g = buildWorkflowGraph(stages, [...attempts, restored], cps);
    expect(
      g.edges.some(
        (e) => e.kind === "reference" && e.source === "s1" && e.target === "s1",
      ),
    ).toBe(true);
    expect(
      g.edges
        .filter((e) => e.kind === "order")
        .map((e) => [e.source, e.target]),
    ).toEqual([
      ["s1", "s2"],
      ["s2", "s3"],
    ]);
  });
  it("does not mutate domain objects or accept a foreign source checkpoint", () => {
    const snapshot = structuredClone({ stages, attempts, cps });
    const foreign = { ...cps[0], workflowId: "elsewhere" };
    const g = buildWorkflowGraph(stages, attempts, [foreign, cps[1]]);
    expect(g.nodes[2].source).toBeUndefined();
    expect({ stages, attempts, cps }).toEqual(snapshot);
  });
});
