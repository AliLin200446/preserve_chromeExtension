import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./domain";
import { decisionLabel } from "./presentation";
import { ReferenceReview, hasUnsavedAnnotation } from "./ReferenceReview";
import "./style.css";
import "./workflow.css";
import "./review.css";
function ReviewWorkspace() {
  const selection = useLiveQuery(async () => {
    const w = await db.settings.get("activeWorkflow");
    const stage = await db.settings.get("activeStage:" + w?.value);
    const a = await db.settings.get("activeAttempt:" + stage?.value);
    return { workflow: w?.value, stage: stage?.value, attempt: a?.value };
  });
  const attempts =
    useLiveQuery(
      () =>
        selection?.stage
          ? db.attempts.where({ stageId: selection.stage }).sortBy("createdAt")
          : [],
      [selection?.stage],
    ) ?? [];
  const workflow = useLiveQuery(
    () =>
      selection?.workflow ? db.workflows.get(selection.workflow) : undefined,
    [selection?.workflow],
  );
  const [locked, setLocked] = useState<string>();
  const selected = locked ?? selection?.attempt ?? attempts.at(-1)?.id;
  const choose = async (id: string) => {
    if (
      hasUnsavedAnnotation() &&
      !window.confirm("Discard unsaved annotation changes?")
    )
      return;
    const a = await db.attempts.get(id);
    if (!a) return;
    setLocked(undefined);
    await db.settings.bulkPut([
      { key: "activeWorkflow", value: a.workflowId },
      { key: "activeStage:" + a.workflowId, value: a.stageId },
      { key: "activeAttempt:" + a.stageId, value: a.id },
    ]);
  };
  return (
    <div className="review-workspace">
      <header className="review-workspace-header">
        <div>
          <span className="wordmark">PRESERVE</span>
          <p>{workflow?.name}</p>
          <h1>Review workspace</h1>
        </div>
        <label>
          Iteration
          <select
            aria-label="Review iteration"
            value={selected ?? ""}
            onChange={(e) => void choose(e.target.value)}
          >
            {attempts.map((a, i) => (
              <option key={a.id} value={a.id}>
                Iteration {String(i + 1).padStart(2, "0")} ·{" "}
                {decisionLabel[a.status]}
              </option>
            ))}
          </select>
        </label>
        <a href="index.html#notebook" target="_blank" rel="noreferrer">
          Open Notebook ↗
        </a>
      </header>
      {selected ? (
        <div
          onFocusCapture={() => {
            if (hasUnsavedAnnotation()) setLocked(selected);
          }}
        >
          <ReferenceReview
            key={selected}
            attemptId={selected}
            workspace
            onDirtyChange={(dirty) => setLocked(dirty ? selected : undefined)}
            onRetry={(id) => void choose(id)}
            onOpenSource={(id) => void choose(id)}
          />
        </div>
      ) : (
        <p className="empty-state">
          Choose an iteration in the Notebook to begin review.
        </p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<ReviewWorkspace />);
