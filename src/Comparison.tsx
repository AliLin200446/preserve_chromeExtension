import { useRef, useState } from "react";
import { exportPrompt, type Attempt } from "./domain";
import { Preview } from "./NotebookPieces";
import { decisionLabel, ordinal } from "./presentation";
export function Comparison({
  attempts,
  ids,
  onIds,
  onDecision,
  busy,
}: {
  attempts: Attempt[];
  ids: string[];
  onIds: (ids: string[]) => void;
  onDecision: (a: Attempt, action: "keep" | "reject" | "revise") => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"side" | "slider">("side");
  const [split, setSplit] = useState(50);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const chosen = ids.map((id) => attempts.find((a) => a.id === id));
  const image = (a: Attempt | undefined, i: number) => (
    <div
      className="comparison-transform"
      style={{
        transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
      }}
    >
      <Preview blob={a?.image} label={`Comparison image ${i + 1}`} />
    </div>
  );
  const panEvents = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        originX: view.x,
        originY: view.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag.current)
        setView((v) => ({
          ...v,
          x: drag.current!.originX + e.clientX - drag.current!.x,
          y: drag.current!.originY + e.clientY - drag.current!.y,
        }));
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
  return (
    <div
      ref={root}
      className={`visual-comparison ${fullscreen ? "inspection-fullscreen" : ""}`}
    >
      <div className="comparison-toolbar">
        <button aria-pressed={mode === "side"} onClick={() => setMode("side")}>
          Side by side
        </button>
        <button
          aria-pressed={mode === "slider"}
          onClick={() => setMode("slider")}
        >
          Before / after
        </button>
        <button onClick={() => setFullscreen((v) => !v)}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen inspection"}
        </button>
        <button
          aria-label="Comparison zoom out"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.max(1, v.zoom / 1.25) }))
          }
        >
          −
        </button>
        <output aria-label="Comparison zoom">
          {Math.round(view.zoom * 100)}%
        </output>
        <button
          aria-label="Comparison zoom in"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.min(5, v.zoom * 1.25) }))
          }
        >
          +
        </button>
        <button onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
          Reset view
        </button>
      </div>
      <div className="comparison-selectors">
        {[0, 1].map((i) => (
          <label key={i}>
            Image {i + 1}
            <select
              aria-label={`Comparison ${i + 1}`}
              value={ids[i] ?? ""}
              onChange={(e) =>
                onIds(ids.map((id, j) => (i === j ? e.target.value : id)))
              }
            >
              {attempts.map((a, j) => (
                <option key={a.id} value={a.id}>
                  Iteration {ordinal(j + 1)} · {decisionLabel[a.status]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {mode === "side" ? (
        <div className="comparison-images">
          {chosen.map((a, i) => (
            <div key={i} className="comparison-image" {...panEvents}>
              {image(a, i)}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="comparison-wipe comparison-image" {...panEvents}>
            {image(chosen[1], 1)}
            <div
              className="comparison-before"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            >
              {image(chosen[0], 0)}
            </div>
            <span className="wipe-line" style={{ left: `${split}%` }} />
          </div>
          <label className="slider-label">
            Before / after position
            <input
              aria-label="Before / after position"
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </label>
        </>
      )}
      <p className="helper">
        Drag either image to pan both. Zoom is synchronized.
      </p>
      <div className="comparison-decisions">
        {chosen.map((a, i) => (
          <div key={i}>
            {a && (
              <>
                <span className={`decision-text ${a.status.toLowerCase()}`}>
                  Image {i + 1} · {decisionLabel[a.status]}
                </span>
                <p>{a.notes || a.failure?.explanation}</p>
                <details className="disclosure">
                  <summary>Direction notes</summary>
                  <pre>{exportPrompt(a.prompt, a.contract)}</pre>
                </details>
                <div className="inline-actions">
                  {a.status === "DRAFT" && (
                    <>
                      <button
                        className="primary"
                        disabled={busy || !a.image}
                        onClick={() => onDecision(a, "keep")}
                      >
                        Keep image {i + 1}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onDecision(a, "reject")}
                      >
                        Reject image {i + 1}
                      </button>
                    </>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => onDecision(a, "revise")}
                  >
                    Revise image {i + 1}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
