import {
  ArrowUpRight,
  Check,
  MoreHorizontal,
  Circle,
  RotateCcw,
  Image as ImageIcon,
} from "lucide-react";
import { Preview } from "./NotebookPieces";
import { ordinal } from "./presentation";
import type { Stage } from "./domain";
import type { StageNodeData } from "./graph";
export interface StageActions {
  rename: (s: Stage) => void;
  move: (s: Stage, delta: number) => void;
  addAfter: (s: Stage) => void;
  remove: (s: Stage) => void;
}
export function NodeContent({
  node,
  expanded = false,
}: {
  node: StageNodeData;
  expanded?: boolean;
}) {
  const { stage, output, latest, source, sourceStage, missingSource } = node;
  const previewIteration = latest?.image
    ? latest
    : node.iterations
        .slice()
        .reverse()
        .find((a) => a.image);
  const version = (id?: string) =>
    ordinal(node.iterations.findIndex((a) => a.id === id) + 1);
  return (
    <>
      <div className="node-header">
        <span>{ordinal(node.index + 1)}</span>
        <h3>{stage.name}</h3>
      </div>
      <div className="node-body">
        {expanded ? (
          <>
            <div className="node-image-pair">
              <figure>
                <span className="node-micro-label">Approved source</span>
                {source ? (
                  <Preview
                    thumbnail
                    blob={source.image}
                    label={`Approved input for ${stage.name}`}
                  />
                ) : (
                  <div className="node-empty">
                    <ImageIcon size={18} />
                    {missingSource ? "Unavailable" : "No reference"}
                  </div>
                )}
              </figure>
              <figure>
                <span className="node-micro-label">Latest iteration</span>
                {latest?.image ? (
                  <Preview
                    thumbnail
                    blob={latest.image}
                    label={`Latest output for ${stage.name}`}
                  />
                ) : (
                  <div className="node-empty">
                    <ImageIcon size={18} />
                    No output yet
                  </div>
                )}
              </figure>
            </div>
            {output && (
              <div className="node-kept-output">
                <Preview
                  thumbnail
                  blob={output.image}
                  label={`Approved output for ${stage.name}`}
                  small
                />
                <span>
                  <Check size={14} />
                  Kept output · {version(output.attemptId)}
                </span>
              </div>
            )}
            <p className="node-objective">
              {node.selectedIteration?.prompt.objective ||
                "A new stage, ready for your direction."}
            </p>
          </>
        ) : (
          <>
            {output?.image || previewIteration?.image ? (
              <figure className="node-hero">
                <Preview
                  thumbnail
                  blob={output?.image ?? previewIteration?.image}
                  label={`${output ? "Approved reference" : "Latest uploaded iteration"} — ${stage.name}`}
                />
              </figure>
            ) : (
              <div className="node-empty">
                <ImageIcon size={18} />
                <span>No image yet · ready to begin</span>
              </div>
            )}
          </>
        )}
        {expanded && (
          <>
            <div className="node-input">
              <span className="port input-port" aria-hidden="true" />
              <span>
                {source
                  ? `Input: ${sourceStage?.name ?? "Unavailable stage"} · approved reference`
                  : missingSource
                    ? "Input: reference unavailable"
                    : "Input: no reference attached"}
              </span>
            </div>
            <div className={`node-output ${output ? "resolved" : ""}`}>
              <span className="port output-port" aria-hidden="true" />
              <span>
                {output
                  ? `Output: kept iteration ${version(output.attemptId)}`
                  : node.missingOutput
                    ? "Output: approved checkpoint unavailable"
                    : "Output: no approved checkpoint yet"}
              </span>
            </div>
          </>
        )}
      </div>
      <div className="node-footer">
        <span>
          {node.iterations.length}{" "}
          {node.iterations.length === 1 ? "iteration" : "iterations"}
        </span>
        <span
          className={`stage-status ${stage.status.toLowerCase().replaceAll(" ", "-")}`}
        >
          {stage.status === "Approved" ? (
            <Check size={13} />
          ) : stage.status === "Needs Revision" ? (
            <RotateCcw size={13} />
          ) : (
            <Circle size={11} />
          )}{" "}
          {stage.status}
        </span>
      </div>
    </>
  );
}
export function WorkflowMap({
  nodes,
  selectedId,
  onOpen,
  onCanvas,
  actions,
  busy,
}: {
  nodes: StageNodeData[];
  selectedId?: string;
  onOpen: (stage: Stage) => void;
  onCanvas: () => void;
  actions: StageActions;
  busy: boolean;
}) {
  return (
    <section className="workflow-map">
      <div className="map-heading">
        <h1>Workflow</h1>
        <button className="text-button" onClick={onCanvas}>
          Open Canvas
          <ArrowUpRight size={15} />
        </button>
      </div>
      <ol className="vertical-flow">
        {nodes.map((node, index) => (
          <li
            key={node.stage.id}
            className={`${node.stage.id === selectedId ? "selected-stage" : ""}`}
            data-stage-id={node.stage.id}
          >
            <article className="workflow-node">
              <button
                className="node-open"
                aria-label={`Open stage ${ordinal(index + 1)}: ${node.stage.name}`}
                aria-current={node.stage.id === selectedId ? "step" : undefined}
                disabled={busy}
                onClick={() => onOpen(node.stage)}
              >
                <NodeContent node={node} />
              </button>
              <details className="node-menu">
                <summary aria-label={`Stage actions for ${node.stage.name}`}>
                  <MoreHorizontal size={18} />
                </summary>
                <div>
                  <button
                    disabled={busy}
                    onClick={() => actions.rename(node.stage)}
                  >
                    Rename stage
                  </button>
                  <button
                    disabled={busy || index === 0}
                    onClick={() => actions.move(node.stage, -1)}
                  >
                    Move up
                  </button>
                  <button
                    disabled={busy || index === nodes.length - 1}
                    onClick={() => actions.move(node.stage, 1)}
                  >
                    Move down
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => actions.addAfter(node.stage)}
                  >
                    Add stage after
                  </button>
                  <button
                    disabled={busy}
                    className="danger-text"
                    onClick={() => actions.remove(node.stage)}
                  >
                    Delete stage
                  </button>
                </div>
              </details>
            </article>
            {index < nodes.length - 1 && (
              <div
                className="vertical-connector"
                aria-label="Next stage in workflow order"
              >
                <span />
              </div>
            )}
          </li>
        ))}
      </ol>
      {!nodes.length && (
        <p className="empty-state">
          Add a stage to begin mapping your creative process.
        </p>
      )}
    </section>
  );
}
