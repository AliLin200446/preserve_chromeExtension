import type { Attempt, Checkpoint, Stage } from "./domain";
export interface StageNodeData {
  stage: Stage;
  index: number;
  iterations: Attempt[];
  latest?: Attempt;
  selectedIteration?: Attempt;
  output?: Checkpoint;
  source?: Checkpoint;
  sourceStage?: Stage;
  missingSource: boolean;
  missingOutput: boolean;
}
export interface WorkflowEdge {
  id: string;
  kind: "order" | "reference";
  source: string;
  target: string;
  checkpointId?: string;
  attemptIds: string[];
  highlighted: boolean;
}
export interface AttemptLink {
  id: string;
  kind: "reference" | "retry";
  sourceId: string;
  targetId: string;
  checkpointId?: string;
  available: boolean;
  selected: boolean;
}
/** Read-only projections. Order never implies a reference; only persisted IDs do. */
export function buildWorkflowGraph(
  stages: Stage[],
  attempts: Attempt[],
  checkpoints: Checkpoint[],
  selectedStageId?: string,
  selectedAttemptId?: string,
) {
  const ordered = [...stages].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const stageIds = new Set(ordered.map((s) => s.id));
  const byCheckpoint = new Map(checkpoints.map((c) => [c.id, c]));
  const nodes: StageNodeData[] = ordered.map((stage, index) => {
    const iterations = attempts
      .filter(
        (a) => a.stageId === stage.id && a.workflowId === stage.workflowId,
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const latest = iterations.at(-1);
    const selectedIteration =
      stage.id === selectedStageId
        ? (iterations.find((a) => a.id === selectedAttemptId) ?? latest)
        : latest;
    const rawOutput = stage.currentCheckpointId
      ? byCheckpoint.get(stage.currentCheckpointId)
      : undefined;
    const output =
      rawOutput?.stageId === stage.id &&
      rawOutput.workflowId === stage.workflowId
        ? rawOutput
        : undefined;
    const rawSource = selectedIteration?.sourceCheckpointId
      ? byCheckpoint.get(selectedIteration.sourceCheckpointId)
      : undefined;
    const source =
      rawSource?.workflowId === stage.workflowId ? rawSource : undefined;
    return {
      stage,
      index,
      iterations,
      latest,
      selectedIteration,
      output,
      source,
      sourceStage: ordered.find((s) => s.id === source?.stageId),
      missingSource: !!selectedIteration?.sourceCheckpointId && !source,
      missingOutput: !!stage.currentCheckpointId && !output,
    };
  });
  const edges: WorkflowEdge[] = ordered.slice(1).map((s, index) => ({
    id: `order:${ordered[index].id}:${s.id}`,
    kind: "order",
    source: ordered[index].id,
    target: s.id,
    attemptIds: [],
    highlighted: false,
  }));
  const refs = new Map<string, WorkflowEdge>();
  for (const attempt of attempts) {
    const cp = attempt.sourceCheckpointId
      ? byCheckpoint.get(attempt.sourceCheckpointId)
      : undefined;
    if (
      !cp ||
      cp.workflowId !== attempt.workflowId ||
      !stageIds.has(cp.stageId) ||
      !stageIds.has(attempt.stageId)
    )
      continue;
    const key = `reference:${cp.id}:${attempt.stageId}`;
    const selected =
      nodes.find((n) => n.stage.id === selectedStageId)?.selectedIteration
        ?.id === attempt.id;
    const edge = refs.get(key) ?? {
      id: key,
      kind: "reference" as const,
      source: cp.stageId,
      target: attempt.stageId,
      checkpointId: cp.id,
      attemptIds: [],
      highlighted: false,
    };
    edge.attemptIds.push(attempt.id);
    edge.highlighted ||=
      selected ||
      (cp.stageId === selectedStageId &&
        nodes.find((n) => n.stage.id === selectedStageId)?.selectedIteration
          ?.id === cp.attemptId);
    refs.set(key, edge);
  }
  return { nodes, edges: [...edges, ...refs.values()] };
}
export function buildAttemptLinks(
  attempts: Attempt[],
  checkpoints: Checkpoint[],
  selectedId?: string,
): AttemptLink[] {
  const result: AttemptLink[] = [];
  for (const a of attempts) {
    if (a.sourceCheckpointId) {
      const cp = checkpoints.find(
        (c) => c.id === a.sourceCheckpointId && c.workflowId === a.workflowId,
      );
      result.push({
        id: `ref:${a.id}`,
        kind: "reference",
        sourceId: cp?.attemptId ?? a.sourceCheckpointId,
        targetId: a.id,
        checkpointId: a.sourceCheckpointId,
        available: !!cp,
        selected: selectedId === a.id,
      });
    }
    const parentId = a.parentIterationId ?? a.previousAttemptId;
    if (parentId)
      result.push({
        id: `retry:${a.id}`,
        kind: "retry",
        sourceId: parentId,
        targetId: a.id,
        available: attempts.some(
          (p) => p.id === parentId && p.workflowId === a.workflowId,
        ),
        selected: selectedId === a.id,
      });
  }
  return result;
}
