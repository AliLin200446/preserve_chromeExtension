import { useEffect, useRef, useState } from "react";
import { normalizePoint, type ImageAnnotation } from "./domain";
export interface ImageView {
  zoom: number;
  x: number;
  y: number;
}
export function ReviewImage({
  blob,
  label,
  pins = [],
  selectedId,
  onSelect,
  onPlace,
  placing = false,
  view,
  onView,
}: {
  blob?: Blob;
  label: string;
  pins?: ImageAnnotation[];
  selectedId?: string;
  onSelect?: (a: ImageAnnotation) => void;
  onPlace?: (p: { x: number; y: number }) => void;
  placing?: boolean;
  view: ImageView;
  onView: (v: ImageView) => void;
}) {
  const [url, setUrl] = useState("");
  const [natural, setNatural] = useState({ width: 4, height: 3 });
  const [size, setSize] = useState({ width: 300, height: 300 });
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    view: ImageView;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(
    size.width / natural.width,
    size.height / natural.height,
  );
  return (
    <div
      ref={frame}
      className={`review-frame ${placing ? "placing-pin" : ""}`}
      style={{ height: Math.min(550, Math.max(180, size.width * 0.75)) }}
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-20, 0],
          ArrowRight: [20, 0],
          ArrowUp: [0, -20],
          ArrowDown: [0, 20],
        };
        if (moves[e.key]) {
          e.preventDefault();
          onView({
            ...view,
            x: view.x + moves[e.key][0],
            y: view.y + moves[e.key][1],
          });
        }
        if (e.key === "Home") onView({ zoom: 1, x: 0, y: 0 });
      }}
      onPointerDown={(e) => {
        if (
          placing ||
          (e.target as HTMLElement).closest("button") ||
          e.button !== 0
        )
          return;
        drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) {
          d.moved ||= Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
          onView({
            ...d.view,
            x: d.view.x + e.clientX - d.x,
            y: d.view.y + e.clientY - d.y,
          });
        }
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      {blob && url ? (
        <div
          className="review-image-plane"
          style={{
            width: natural.width * scale,
            height: natural.height * scale,
            left: (size.width - natural.width * scale) / 2,
            top: (size.height - natural.height * scale) / 2,
            transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
          }}
          onClick={(e) => {
            if (
              !placing ||
              !onPlace ||
              (e.target as HTMLElement).closest("button")
            )
              return;
            const r = e.currentTarget.getBoundingClientRect();
            onPlace(
              normalizePoint(
                e.clientX - r.left,
                e.clientY - r.top,
                r.width,
                r.height,
              ),
            );
          }}
        >
          <img
            src={url}
            alt={label}
            draggable={false}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
          />
          {pins.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`annotation-pin ${p.id === selectedId ? "selected" : ""}`}
              aria-label={`Annotation ${i + 1}: ${p.category}. ${p.note}`}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                transform: `translate(-50%,-50%) scale(${1 / view.zoom})`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(p);
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      ) : (
        <p className="review-empty">
          {label === "Last Approved Reference"
            ? "No approved source image is available. Select a stored checkpoint when creating a new iteration."
            : "No saved output yet. Upload and save an image in the Notebook, then reopen review."}
        </p>
      )}
    </div>
  );
}
