import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  GripVertical,
  Maximize,
  MessageSquare,
  Minus,
  Plus,
} from "lucide-react";
import type { Attempt, Checkpoint, Stage } from "./domain";
import type { StageNodeData, WorkflowEdge } from "./graph";
import { NodeContent, type StageActions } from "./WorkflowMap";
import { Preview } from "./NotebookPieces";
import { decisionLabel, ordinal } from "./presentation";
type Point = { x: number; y: number };
const WIDTH = 304,
  HEIGHT = 420,
  GAP = 100;
type Gesture = {
  kind: "pan" | "node" | "link";
  start: Point;
  origin: Point;
  id?: string;
  moved: boolean;
};
export function WorkflowCanvas({
  nodes,
  edges,
  selectedId,
  checkpoints,
  onSelect,
  onOpen,
  onInspect,
  onBranch,
  onReturn,
  onMove,
  actions,
  onAdd,
  busy,
}: {
  nodes: StageNodeData[];
  edges: WorkflowEdge[];
  selectedId?: string;
  checkpoints: Checkpoint[];
  onSelect: (s: Stage) => void;
  onOpen: (s: Stage) => void;
  onInspect: (a: Attempt, notebook?: boolean) => void;
  onBranch: (a: Attempt) => void;
  onReturn: (cp: string, target: string, parent?: string) => void;
  onMove: (id: string, point: Point) => void;
  actions: StageActions;
  onAdd: () => void;
  busy: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 20, y: 24, zoom: 0.9 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [connection, setConnection] = useState<string>();
  const [cursor, setCursor] = useState<Point>();
  const [targetStage, setTargetStage] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{
    distance: number;
    center: Point;
    view: typeof view;
  } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const positionVersion = nodes
    .map(
      (n) =>
        `${n.stage.id}:${n.stage.visualPosition?.x}:${n.stage.visualPosition?.y}`,
    )
    .join("|");
  useEffect(() => {
    if (gesture.current?.kind !== "node") setPositions({});
  }, [positionVersion]);
  const point = (id: string): Point =>
    positions[id] ??
    nodes.find((n) => n.stage.id === id)?.stage.visualPosition ?? {
      x: 40,
      y:
        Math.max(
          0,
          nodes.findIndex((n) => n.stage.id === id),
        ) *
          (HEIGHT + GAP) +
        40,
    };
  const selected = nodes.find((n) => n.stage.id === selectedId);
  const attempt = selected?.selectedIteration;
  const keptFor = (node: StageNodeData) =>
    checkpoints.find((c) => c.attemptId === node.selectedIteration?.id) ??
    node.output;
  const selectedCheckpoint = checkpoints.find(
    (c) => c.attemptId === attempt?.id,
  );
  const label = (a: Attempt) =>
    `Iteration ${ordinal((nodes.find((n) => n.stage.id === a.stageId)?.iterations.findIndex((p) => p.id === a.id) ?? -1) + 1)}`;
  const allAttempts = nodes.flatMap((n) => n.iterations);
  const sourceAttempt = allAttempts.find(
    (a) => a.id === selected?.source?.attemptId,
  );
  const downstream = selectedCheckpoint
    ? allAttempts.filter((a) => a.sourceCheckpointId === selectedCheckpoint.id)
    : [];
  const bounds = nodes.map((n) => point(n.stage.id));
  const minX = Math.min(0, ...bounds.map((p) => p.x)),
    minY = Math.min(0, ...bounds.map((p) => p.y));
  const maxX = Math.max(400, ...bounds.map((p) => p.x + WIDTH + 80)),
    maxY = Math.max(600, ...bounds.map((p) => p.y + HEIGHT + 80));
  const fit = () => {
    const box = viewport.current;
    if (!box) return;
    const zoom = Math.max(
      0.12,
      Math.min(
        1,
        (box.clientWidth - 40) / (maxX - minX),
        (box.clientHeight - 40) / (maxY - minY),
      ),
    );
    setView({
      x: (box.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: 20 - minY * zoom,
      zoom,
    });
  };
  const focusNode = (id?: string) => {
    const box = viewport.current;
    if (!box || !id) return;
    const p = point(id);
    setView((v) => ({
      ...v,
      x: (box.clientWidth - WIDTH * v.zoom) / 2 - p.x * v.zoom,
      y: 30 - p.y * v.zoom,
    }));
  };
  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const center = () => {
      if (!selectedId) return;
      const p = point(selectedId);
      setView((v) => {
        const zoom = Math.min(
          v.zoom,
          0.9,
          (box.clientWidth - 50) / WIDTH,
          (box.clientHeight - 45) / HEIGHT,
        );
        return {
          zoom: Math.max(0.12, zoom),
          x: (box.clientWidth - WIDTH * zoom) / 2 - p.x * zoom,
          y: 24 - p.y * zoom,
        };
      });
    };
    const observer = new ResizeObserver(center);
    observer.observe(box);
    center();
    return () => observer.disconnect();
  }, [selectedId]);
  const zoomBy = (factor: number) => {
    const box = viewport.current;
    if (!box) return;
    setView((v) => {
      const zoom = Math.min(2.5, Math.max(0.12, v.zoom * factor));
      const x = box.clientWidth / 2,
        y = box.clientHeight / 2;
      return {
        zoom,
        x: x - ((x - v.x) * zoom) / v.zoom,
        y: y - ((y - v.y) * zoom) / v.zoom,
      };
    });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      setView((v) => {
        const zoom = Math.min(
          2.5,
          Math.max(0.12, v.zoom * Math.exp(-e.deltaY * 0.0015)),
        );
        return {
          zoom,
          x: x - ((x - v.x) * zoom) / v.zoom,
          y: y - ((y - v.y) * zoom) / v.zoom,
        };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const connect = (target: string) => {
    const origin = nodes.find((n) => n.stage.id === connection);
    const cp = origin && keptFor(origin);
    if (!cp || busy) return;
    onReturn(cp.id, target);
    setConnection(undefined);
    setCursor(undefined);
  };
  const begin = (e: React.PointerEvent, kind: Gesture["kind"], id?: string) => {
    if (busy || e.button !== 0) return;
    e.stopPropagation();
    if (kind === "link") {
      setConnection(id);
      setCursor(undefined);
    }
    const start = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, start);
    gesture.current = {
      kind,
      id,
      start,
      origin: kind === "node" && id ? point(id) : { x: view.x, y: view.y },
      moved: false,
    };
    viewport.current?.setPointerCapture(e.pointerId);
  };
  return (
    <section className="canvas-view decision-canvas">
      <div className="canvas-title">
        <h1>Workflow canvas</h1>
        <div className="canvas-toolbar">
          <select
            aria-label="Select canvas stage"
            value={selectedId ?? ""}
            onChange={(e) => {
              const n = nodes.find((n) => n.stage.id === e.target.value);
              if (n) {
                onSelect(n.stage);
                setInspecting(true);
                focusNode(n.stage.id);
              }
            }}
          >
            {nodes.map((n) => (
              <option key={n.stage.id} value={n.stage.id}>
                {n.index + 1} / {n.stage.name}
              </option>
            ))}
          </select>
          <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            <Minus size={16} />
          </button>
          <output aria-label="Canvas zoom">
            {Math.round(view.zoom * 100)}%
          </output>
          <button aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
            <Plus size={16} />
          </button>
          <button onClick={fit}>
            <Maximize size={15} />
            Fit to view
          </button>
        </div>
      </div>
      <div className="canvas-legend">
        <span>
          <i className="order-swatch" />
          Stage order
        </span>
        <span>
          <i className="reference-swatch" />
          Image reference
        </span>
      </div>
      {connection && (
        <div className="connection-hint" role="status">
          Choose a stage’s input handle to create a draft from this approved
          reference.
          <button onClick={() => setConnection(undefined)}>
            Cancel connection
          </button>
        </div>
      )}
      <div
        className="graph-viewport"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Interactive workflow canvas"
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const d: Record<string, Point> = {
            ArrowLeft: { x: 50, y: 0 },
            ArrowRight: { x: -50, y: 0 },
            ArrowUp: { x: 0, y: 50 },
            ArrowDown: { x: 0, y: -50 },
          };
          if (d[e.key]) {
            e.preventDefault();
            setView((v) => ({
              ...v,
              x: v.x + d[e.key].x,
              y: v.y + d[e.key].y,
            }));
          }
          if (e.key === "+" || e.key === "=") zoomBy(1.2);
          if (e.key === "-") zoomBy(1 / 1.2);
          if (e.key === "Home") fit();
          if (e.key === "Escape") setConnection(undefined);
        }}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const r = e.currentTarget.getBoundingClientRect();
            pinch.current = {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              center: {
                x: (a.x + b.x) / 2 - r.left,
                y: (a.y + b.y) / 2 - r.top,
              },
              view,
            };
            gesture.current = null;
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
          if (!(e.target as HTMLElement).closest(".canvas-node"))
            begin(e, "pan");
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId))
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const p = pinch.current;
            const r = e.currentTarget.getBoundingClientRect();
            const zoom = Math.min(
              2.5,
              Math.max(
                0.12,
                (p.view.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / p.distance,
              ),
            );
            setView({
              zoom,
              x:
                (a.x + b.x) / 2 -
                r.left -
                ((p.center.x - p.view.x) * zoom) / p.view.zoom,
              y:
                (a.y + b.y) / 2 -
                r.top -
                ((p.center.y - p.view.y) * zoom) / p.view.zoom,
            });
            return;
          }
          const g = gesture.current;
          if (!g) return;
          const dx = e.clientX - g.start.x,
            dy = e.clientY - g.start.y;
          g.moved ||= Math.hypot(dx, dy) > 4;
          if (g.kind === "pan")
            setView((v) => ({ ...v, x: g.origin.x + dx, y: g.origin.y + dy }));
          if (g.kind === "node" && g.id)
            setPositions((p) => ({
              ...p,
              [g.id!]: {
                x: g.origin.x + dx / view.zoom,
                y: g.origin.y + dy / view.zoom,
              },
            }));
          if (g.kind === "link") {
            const r = e.currentTarget.getBoundingClientRect();
            setCursor({
              x: (e.clientX - r.left - view.x) / view.zoom,
              y: (e.clientY - r.top - view.y) / view.zoom,
            });
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
          const g = gesture.current;
          gesture.current = null;
          if (g?.kind === "node" && g.id && g.moved) {
            onMove(g.id, {
              x: g.origin.x + (e.clientX - g.start.x) / view.zoom,
              y: g.origin.y + (e.clientY - g.start.y) / view.zoom,
            });
          }
          if (g?.kind === "link" && g.moved) {
            const target = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-target-handle]")
              ?.dataset.targetHandle;
            if (target) connect(target);
          }
        }}
        onPointerCancel={() => {
          gesture.current = null;
          pointers.current.clear();
          pinch.current = null;
          setCursor(undefined);
        }}
      >
        <div
          className="graph-world"
          style={{
            width: maxX,
            height: maxY,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <svg
            className="graph-connections"
            width={maxX}
            height={maxY}
            aria-label="Stored reference connections"
          >
            {edges.map((edge, i) => {
              const a = point(edge.source),
                b = point(edge.target),
                ref = edge.kind === "reference";
              const lane = Math.max(a.x, b.x) + WIDTH + 30 + (i % 4) * 15;
              const active = edge.highlighted;
              const route = ref
                ? `M ${a.x + WIDTH} ${a.y + HEIGHT / 2} C ${lane + 80} ${a.y + HEIGHT / 2}, ${lane + 80} ${b.y + HEIGHT / 2}, ${b.x} ${b.y + HEIGHT / 2}`
                : `M ${a.x + WIDTH / 2} ${a.y + HEIGHT} L ${b.x + WIDTH / 2} ${b.y}`;
              return (
                <g
                  key={edge.id}
                  data-edge-kind={edge.kind}
                  data-source={edge.source}
                  data-target={edge.target}
                  data-checkpoint={edge.checkpointId}
                  className={`${ref ? "reference-edge" : "order-edge"} ${active ? "highlighted" : ""}`}
                >
                  <title>
                    {ref
                      ? "Approved image reference"
                      : "Stage order; not image inheritance"}
                  </title>
                  <path d={route} />
                </g>
              );
            })}
            {connection && cursor && (
              <path
                className="pending-edge"
                d={`M ${point(connection).x + WIDTH} ${point(connection).y + HEIGHT / 2} L ${cursor.x} ${cursor.y}`}
              />
            )}
          </svg>
          {nodes.map((node) => {
            const p = point(node.stage.id);
            const cp = keptFor(node);
            const related = edges.some(
              (e) =>
                e.kind === "reference" &&
                e.highlighted &&
                (e.source === node.stage.id || e.target === node.stage.id),
            );
            return (
              <article
                key={node.stage.id}
                data-stage-id={node.stage.id}
                className={`canvas-node ${node.stage.id === selectedId ? "selected-stage" : ""} ${related ? "source-stage" : ""}`}
                style={{ left: p.x, top: p.y, width: WIDTH, height: HEIGHT }}
              >
                <button
                  className="node-grip"
                  aria-label={`Move stage ${node.index + 1}`}
                  title="Drag to move; arrow keys to nudge"
                  onPointerDown={(e) => begin(e, "node", node.stage.id)}
                  onKeyDown={(e) => {
                    const d: Record<string, Point> = {
                      ArrowLeft: { x: -20, y: 0 },
                      ArrowRight: { x: 20, y: 0 },
                      ArrowUp: { x: 0, y: -20 },
                      ArrowDown: { x: 0, y: 20 },
                    };
                    if (d[e.key]) {
                      e.preventDefault();
                      const pos = { x: p.x + d[e.key].x, y: p.y + d[e.key].y };
                      setPositions((v) => ({ ...v, [node.stage.id]: pos }));
                      onMove(node.stage.id, pos);
                    }
                  }}
                >
                  <GripVertical size={16} />
                </button>
                <button
                  className="node-select"
                  aria-label={`Select stage ${node.index + 1}: ${node.stage.name}`}
                  aria-pressed={node.stage.id === selectedId}
                  onClick={(e) => {
                    clearTimeout(clickTimer.current);
                    const inspect = () => {
                      onSelect(node.stage);
                      setInspecting(true);
                    };
                    if (e.detail === 0) inspect();
                    else clickTimer.current = setTimeout(inspect, 230);
                  }}
                  onDoubleClick={() => {
                    clearTimeout(clickTimer.current);
                    onOpen(node.stage);
                  }}
                >
                  <NodeContent node={node} />
                </button>
                {(node.selectedIteration?.notes ||
                  node.selectedIteration?.failure?.explanation) && (
                  <span
                    className="node-note"
                    title="Decision note available"
                    aria-label="Decision note available"
                  >
                    <MessageSquare size={14} />
                  </span>
                )}
                <button
                  className="connection-handle input-handle"
                  data-target-handle={node.stage.id}
                  aria-label={`Use reference in stage ${node.index + 1}`}
                  disabled={!connection || busy}
                  onClick={() => connect(node.stage.id)}
                  title="Use connected reference"
                />
                <button
                  className="connection-handle output-handle"
                  aria-label={`Connect reference from stage ${node.index + 1}`}
                  disabled={!cp || busy}
                  onPointerDown={(e) => begin(e, "link", node.stage.id)}
                  onClick={(e) => {
                    if (e.detail === 0) setConnection(node.stage.id);
                  }}
                  title={
                    cp
                      ? "Connect approved reference"
                      : "Approve an iteration to connect"
                  }
                />
                <button
                  className="canvas-open-notebook"
                  onClick={() => onOpen(node.stage)}
                >
                  Open notebook
                  <ArrowUpRight size={14} />
                </button>
              </article>
            );
          })}
        </div>
      </div>
      <div className="canvas-selection">
        <span>{selected?.stage.name ?? "Select a stage"}</span>
        {selected && (
          <button
            className="text-button"
            onClick={() => onOpen(selected.stage)}
          >
            Open selected notebook
            <ArrowUpRight size={14} />
          </button>
        )}
        <button
          className="text-button"
          onClick={() => setInspecting((v) => !v)}
        >
          {inspecting ? "Close iterations" : "Inspect iterations"}
        </button>
      </div>
      {inspecting && selected && (
        <aside className="canvas-inspector" aria-label="Stage iterations">
          <div className="inspector-heading">
            <h2>{selected.stage.name}</h2>
            <details className="inspector-actions">
              <summary>Stage options</summary>
              <div>
                <button onClick={() => actions.rename(selected.stage)}>
                  Rename stage
                </button>
                <button
                  disabled={selected.index === 0}
                  onClick={() => actions.move(selected.stage, -1)}
                >
                  Move earlier in order
                </button>
                <button
                  disabled={selected.index === nodes.length - 1}
                  onClick={() => actions.move(selected.stage, 1)}
                >
                  Move later in order
                </button>
                <button onClick={() => actions.addAfter(selected.stage)}>
                  Add stage after
                </button>
                <button onClick={() => actions.remove(selected.stage)}>
                  Delete stage
                </button>
              </div>
            </details>
          </div>
          <div className="iteration-branches">
            {selected.iterations.map((a) => (
              <button
                key={a.id}
                className="iteration-branch"
                data-parent={a.parentIterationId ?? a.previousAttemptId}
                aria-pressed={a.id === attempt?.id}
                onClick={() => onInspect(a)}
              >
                <Preview blob={a.image} label={label(a)} small />
                <span>
                  {label(a)} · {decisionLabel[a.status]}
                </span>
                {(a.parentIterationId ?? a.previousAttemptId) && (
                  <small>
                    ↳ From{" "}
                    {label(
                      selected.iterations.find(
                        (p) =>
                          p.id === (a.parentIterationId ?? a.previousAttemptId),
                      ) ?? a,
                    )}
                  </small>
                )}
                {(a.notes || a.failure?.explanation) && (
                  <MessageSquare size={13} />
                )}
              </button>
            ))}
          </div>
          {!selected.iterations.length && (
            <p className="helper">
              No iterations yet. Open the notebook to begin.
            </p>
          )}
          {attempt && (
            <div className="inline-actions">
              <button disabled={busy} onClick={() => onBranch(attempt)}>
                Branch this iteration
              </button>
              <button
                className="text-button"
                onClick={() => onInspect(attempt, true)}
              >
                Open iteration
              </button>
            </div>
          )}
          {selected.source && (
            <div className="inspector-reference">
              <Preview
                blob={selected.source.image}
                label="Inherited approved image"
                small
              />
              <div>
                <span>Reference used</span>
                <button
                  className="text-button"
                  disabled={!sourceAttempt}
                  onClick={() =>
                    sourceAttempt && onInspect(sourceAttempt, true)
                  }
                >
                  {selected.sourceStage?.name} ·{" "}
                  {sourceAttempt && label(sourceAttempt)}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    onReturn(
                      selected.source!.id,
                      selected.stage.id,
                      attempt?.id,
                    )
                  }
                >
                  Return to this checkpoint
                </button>
              </div>
            </div>
          )}
          {selected.missingSource && (
            <p>
              Reference unavailable. Select another approved checkpoint in the
              Notebook.
            </p>
          )}
          {selectedCheckpoint && (
            <div className="checkpoint-return">
              <label>
                Continue from this approved image
                <select
                  aria-label="Checkpoint target stage"
                  value={
                    nodes.some((n) => n.stage.id === targetStage)
                      ? targetStage
                      : selected.stage.id
                  }
                  onChange={(e) => setTargetStage(e.target.value)}
                >
                  {nodes.map((n) => (
                    <option key={n.stage.id} value={n.stage.id}>
                      {n.stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  const target = nodes.some((n) => n.stage.id === targetStage)
                    ? targetStage
                    : selected.stage.id;
                  onReturn(
                    selectedCheckpoint.id,
                    target,
                    target === selected.stage.id ? attempt?.id : undefined,
                  );
                }}
              >
                Return to this checkpoint
              </button>
            </div>
          )}
          {!!downstream.length && (
            <div className="downstream-list">
              <h3>Uses this image</h3>
              {downstream.map((a) => (
                <button
                  key={a.id}
                  className="text-button"
                  onClick={() => onInspect(a, true)}
                >
                  {nodes.find((n) => n.stage.id === a.stageId)?.stage.name} ·{" "}
                  {label(a)}
                </button>
              ))}
            </div>
          )}
        </aside>
      )}
      <button className="canvas-add" onClick={onAdd} disabled={busy}>
        <Plus size={16} />
        Add stage
      </button>
    </section>
  );
}
