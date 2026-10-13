import { ArrowDown, ArrowUpRight } from "lucide-react";
import type { Attempt, Checkpoint, Stage } from "./domain";
import { buildAttemptLinks } from "./graph";
import { Preview } from "./NotebookPieces";
import { decisionLabel, ordinal } from "./presentation";
export function Lineage({
  attempts,
  checkpoints,
  stages,
  stageId,
  selectedId,
  onOpen,
}: {
  attempts: Attempt[];
  checkpoints: Checkpoint[];
  stages: Stage[];
  stageId: string;
  selectedId?: string;
  onOpen: (a: Attempt) => void;
}) {
  const iterations = attempts
    .filter((a) => a.stageId === stageId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const links = buildAttemptLinks(attempts, checkpoints, selectedId);
  const sourceIds = [
    ...new Set(
      iterations
        .map((a) => a.sourceCheckpointId)
        .filter((v): v is string => !!v),
    ),
  ];
  const label = (a: Attempt) =>
    `${stages.find((s) => s.id === a.stageId)?.name ?? "Unavailable stage"} / Iteration ${ordinal(
      attempts
        .filter((p) => p.stageId === a.stageId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .findIndex((p) => p.id === a.id) + 1,
    )}`;
  return (
    <details className="disclosure lineage">
      <summary>
        Reference branches & iteration history
        <ArrowDown size={15} />
      </summary>
      <p className="helper">
        Solid branches share a stored approved reference. “Retry of” links
        follow the actual previous iteration.
      </p>
      {sourceIds.map((id) => {
        const cp = checkpoints.find((c) => c.id === id);
        const origin = attempts.find((a) => a.id === cp?.attemptId);
        const children = iterations.filter((a) => a.sourceCheckpointId === id);
        const highlighted = children.some((a) => a.id === selectedId);
        return (
          <section
            className={`reference-branch ${highlighted ? "highlighted" : ""}`}
            key={id}
            data-checkpoint={id}
          >
            <div className="branch-source">
              {cp && (
                <Preview
                  blob={cp.image}
                  label="Branch approved reference"
                  small
                />
              )}
              <div>
                <span>Approved reference</span>
                {cp ? (
                  <button
                    className="text-button"
                    disabled={!origin}
                    onClick={() => origin && onOpen(origin)}
                  >
                    {origin
                      ? label(origin)
                      : "Kept reference; iteration unavailable"}
                    <ArrowUpRight size={13} />
                  </button>
                ) : (
                  <p>Reference unavailable</p>
                )}
              </div>
            </div>
            <ol>
              {children.map((a) => (
                <li
                  key={a.id}
                  className={a.id === selectedId ? "selected-iteration" : ""}
                >
                  <button className="text-button" onClick={() => onOpen(a)}>
                    {label(a)} · {decisionLabel[a.status]}
                  </button>
                  {links
                    .filter((l) => l.targetId === a.id && l.kind === "retry")
                    .map((l) => {
                      const parent = attempts.find((p) => p.id === l.sourceId);
                      return (
                        <div className="retry-line" key={l.id}>
                          {parent?.failure ? "Retry of " : "Branch of "}
                          {parent ? (
                            <button
                              className="text-button"
                              onClick={() => onOpen(parent)}
                            >
                              {label(parent)}
                            </button>
                          ) : (
                            "unavailable iteration"
                          )}
                        </div>
                      );
                    })}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {iterations
        .filter((a) => !a.sourceCheckpointId)
        .map((a) => (
          <div className="original-lineage" key={a.id}>
            <button className="text-button" onClick={() => onOpen(a)}>
              {label(a)} · original image
            </button>
            {a.previousAttemptId && (
              <p>
                Previous iteration:{" "}
                {attempts.find((p) => p.id === a.previousAttemptId) ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      onOpen(
                        attempts.find((p) => p.id === a.previousAttemptId)!,
                      )
                    }
                  >
                    {label(attempts.find((p) => p.id === a.previousAttemptId)!)}
                  </button>
                ) : (
                  "unavailable"
                )}
              </p>
            )}
          </div>
        ))}
    </details>
  );
}
