import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  annotationCategories,
  compileRecovery,
  db,
  exportPrompt,
  repo,
  resolveReference,
  type ImageAnnotation,
  type ImageVersion,
} from "./domain";
import { ContractSummary, Preview } from "./NotebookPieces";
import { ReviewImage, type ImageView } from "./ReviewImage";
const home: ImageView = { zoom: 1, x: 0, y: 0 };
export function hasUnsavedAnnotation() {
  return !!document.querySelector('.annotation-editor[data-dirty="true"]');
}
export function ReferenceReview({
  attemptId,
  onRetry,
  onOpenSource,
  workspace = false,
  onDirtyChange,
}: {
  attemptId: string;
  onRetry: (id: string) => void;
  onOpenSource?: (id: string) => void;
  workspace?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const attempt = useLiveQuery(() => db.attempts.get(attemptId), [attemptId]);
  const checkpoint = useLiveQuery(async () => {
    if (!attempt?.sourceCheckpointId) return;
    const cp = await db.checkpoints.get(attempt.sourceCheckpointId);
    return cp && resolveReference(attempt, [cp]);
  }, [attempt?.sourceCheckpointId, attempt?.workflowId]);
  const sourceStage = useLiveQuery(
    () => (checkpoint ? db.stages.get(checkpoint.stageId) : undefined),
    [checkpoint?.stageId],
  );
  const versions =
    useLiveQuery(
      () => db.imageVersions.where({ attemptId }).sortBy("createdAt"),
      [attemptId],
    ) ?? [];
  const [currentVersion, setCurrentVersion] = useState<ImageVersion>();
  const [versionId, setVersionId] = useState("");
  const version = versions.find((v) => v.id === versionId) ?? currentVersion;
  const annotations =
    useLiveQuery(
      () =>
        version
          ? db.annotations
              .where({ imageVersionId: version.id })
              .sortBy("createdAt")
          : [],
      [version?.id],
    ) ?? [];
  const [mode, setMode] = useState<"side" | "toggle" | "slider">(() =>
    workspace ? "side" : "toggle",
  );
  const [shown, setShown] = useState<0 | 1>(1);
  const [split, setSplit] = useState(50);
  const [aligned, setAligned] = useState(false);
  const [views, setViews] = useState<[ImageView, ImageView]>([home, home]);
  const [placing, setPlacing] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string>();
  const [pin, setPin] = useState<{
    id?: string;
    updatedAt?: number;
    x: number;
    y: number;
    note: string;
    category: ImageAnnotation["category"];
  }>();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const savedDirection = useLiveQuery(
    () => db.settings.get("reviewDirection:" + attemptId),
    [attemptId],
  );
  const [direction, setDirection] = useState("");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (dirtyRef.current) {
      setError(
        "This iteration changed in another view. Save your annotation, then reopen review for the current output.",
      );
      return;
    }
    let live = true;
    setVersionId("");
    setCurrentVersion(undefined);
    setPin(undefined);
    setDirty(false);
    setViews([home, home]);
    if (attempt?.image)
      repo
        .ensureImageVersion(attemptId)
        .then((v) => {
          if (live) {
            setCurrentVersion(v);
            setVersionId(v.id);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [attemptId, attempt?.updatedAt]);
  useEffect(() => {
    setDirection(savedDirection?.value ?? attempt?.revisionDirection ?? "");
  }, [attemptId, attempt?.revisionDirection, savedDirection?.value]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const updateView = (i: number, v: ImageView) =>
    setViews((old) =>
      aligned
        ? [v, v]
        : (old.map((p, j) => (i === j ? v : p)) as [ImageView, ImageView]),
    );
  const selectPin = (a: ImageAnnotation) => {
    if (dirty && !window.confirm("Discard unsaved annotation changes?")) return;
    setSelectedPin(a.id);
    setPin(a);
    setDirty(false);
    setShown(1);
    setMode("toggle");
    setViews([home, home]);
  };
  const place = (p: { x: number; y: number }) => {
    setPin({ ...p, note: "", category: "Logo / Typography" });
    setDirty(true);
    setPlacing(false);
    setSelectedPin(undefined);
  };
  const sourceLabel = sourceStage?.name ?? "Approved source reference";
  const effective = attempt
    ? { ...attempt, revisionDirection: direction }
    : undefined;
  const brief = effective
    ? compileRecovery(effective, sourceLabel, annotations)
    : "";
  const prompt = effective
    ? compileRecovery(effective, sourceLabel, annotations, true)
    : "";
  const copy = async (text: string) =>
    act(async () => {
      await navigator.clipboard.writeText(text);
      setMessage("Copied. Ready for your creative tool.");
    });
  const output = version?.image ?? attempt?.image;
  const image = (i: 0 | 1) => (
    <ReviewImage
      blob={i === 0 ? checkpoint?.image : output}
      label={i === 0 ? "Last Approved Reference" : "Current Iteration"}
      pins={i === 1 ? annotations : []}
      selectedId={selectedPin}
      onSelect={selectPin}
      onPlace={place}
      placing={i === 1 && placing}
      view={views[i]}
      onView={(v) => updateView(i, v)}
    />
  );
  if (!attempt)
    return (
      <p className="empty-state">
        This iteration is unavailable. Select another version in the Notebook.
      </p>
    );
  return (
    <div className={`reference-review ${workspace ? "large-review" : ""}`}>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="helper">
          {message}
        </p>
      )}
      <div className="review-lineage">
        <button
          className="reference-source"
          disabled={!checkpoint}
          onClick={() => setSourceOpen((v) => !v)}
        >
          {checkpoint && (
            <Preview
              blob={checkpoint.image}
              label="Approved source thumbnail"
              small
            />
          )}
          <span>
            Approved reference
            <br />
            {checkpoint
              ? sourceLabel
              : attempt.sourceCheckpointId
                ? "Source checkpoint missing"
                : "No source attached"}
          </span>
        </button>
        <span aria-hidden="true">↓</span>
        <span>
          Current iteration ·{" "}
          {attempt.status === "REJECTED"
            ? "For revision"
            : attempt.status === "APPROVED"
              ? "Kept"
              : "In the making"}
        </span>
      </div>
      {!!attempt.sourceCheckpointId && !checkpoint && (
        <p role="alert" className="form-error">
          The stored source checkpoint is unavailable. No replacement has been
          inferred.
        </p>
      )}
      {sourceOpen && checkpoint && (
        <section className="source-inspector">
          <h3>Original checkpoint</h3>
          <ContractSummary contract={checkpoint.contract} />
          <p className="helper">
            Model / platform: {checkpoint.platform || "Not recorded"}
          </p>
          <details className="disclosure">
            <summary>Checkpoint and prompt snapshot</summary>
            <p className="technical-id">{checkpoint.id}</p>
            <pre>{exportPrompt(checkpoint.prompt, checkpoint.contract)}</pre>
          </details>
          {onOpenSource && (
            <button onClick={() => onOpenSource(checkpoint.attemptId)}>
              Open source iteration
            </button>
          )}
        </section>
      )}
      <div className="review-controls">
        <button
          aria-pressed={mode === "toggle"}
          onClick={() => setMode("toggle")}
        >
          Toggle images
        </button>
        <button aria-pressed={mode === "side"} onClick={() => setMode("side")}>
          Side by side
        </button>
        <button
          disabled={!aligned}
          aria-pressed={mode === "slider"}
          onClick={() => setMode("slider")}
        >
          Before / after
        </button>
      </div>
      <div className="image-toggle">
        <button aria-pressed={shown === 0} onClick={() => setShown(0)}>
          Last Approved Reference
        </button>
        <button aria-pressed={shown === 1} onClick={() => setShown(1)}>
          Current Iteration
        </button>
      </div>
      {mode === "side" ? (
        <div className="review-pair">
          <div>
            <span className="helper">Last Approved Reference</span>
            {image(0)}
          </div>
          <div>
            <span className="helper">Current Iteration</span>
            {image(1)}
          </div>
        </div>
      ) : mode === "slider" ? (
        <>
          <div className="review-slider">
            {image(1)}
            <div
              className="review-slider-before"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            >
              {image(0)}
            </div>
            <span className="wipe-line" style={{ left: `${split}%` }} />
          </div>
          <label>
            Before / after position
            <input
              aria-label="Reference comparison position"
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </label>
        </>
      ) : (
        image(shown)
      )}
      <label className="alignment-choice">
        <input
          type="checkbox"
          checked={aligned}
          onChange={(e) => {
            setAligned(e.target.checked);
            setViews([home, home]);
            if (!e.target.checked) setMode("toggle");
          }}
        />
        These images have comparable framing. Link their views.
      </label>
      <p className="helper">
        Original proportions. No automatic alignment or pixel-level diff.
      </p>
      <div className="review-controls">
        <button
          onClick={() =>
            updateView(shown, {
              ...views[shown],
              zoom: Math.max(0.25, views[shown].zoom / 1.25),
            })
          }
          aria-label="Review zoom out"
        >
          −
        </button>
        <output aria-label="Review zoom">
          {Math.round(views[shown].zoom * 100)}%
        </output>
        <button
          onClick={() =>
            updateView(shown, {
              ...views[shown],
              zoom: Math.min(8, views[shown].zoom * 1.25),
            })
          }
          aria-label="Review zoom in"
        >
          +
        </button>
        <button onClick={() => setViews([home, home])}>Fit images</button>
        <button onClick={() => setViews([home, home])}>Reset zoom</button>
      </div>
      <p className="helper">
        Drag to pan. Focus an image and use arrow keys to pan or Home to fit.
      </p>
      <div className="review-body">
        <section className="annotation-sidebar">
          <div className="inline-actions">
            <button
              disabled={!version || busy}
              aria-pressed={placing}
              onClick={() => {
                setShown(1);
                setMode("toggle");
                setPlacing((v) => !v);
              }}
            >
              Place pin
            </button>
            <button
              disabled={!version || busy}
              onClick={() => {
                setShown(1);
                setMode("toggle");
                place({ x: 0.5, y: 0.5 });
              }}
            >
              Add pin at center
            </button>
          </div>
          {placing && (
            <p role="status">Click the current image where it changed.</p>
          )}
          {versions.length > 1 && (
            <label>
              Image version
              <select
                aria-label="Annotated image version"
                value={version?.id ?? ""}
                onChange={(e) => {
                  if (
                    dirty &&
                    !window.confirm("Discard unsaved annotation changes?")
                  )
                    return;
                  setVersionId(e.target.value);
                  setPin(undefined);
                  setDirty(false);
                  setViews([home, home]);
                }}
              >
                {versions.map((v, i) => (
                  <option key={v.id} value={v.id}>
                    {v.id === currentVersion?.id
                      ? "Current output"
                      : `Earlier output ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {version && version.id !== currentVersion?.id && (
            <p className="helper">
              Reviewing an earlier image version. Its annotations remain
              attached to this image.
            </p>
          )}
          <h3>Annotations · {annotations.length}</h3>
          {annotations.map((a, i) => (
            <button
              key={a.id}
              className="annotation-entry"
              aria-pressed={a.id === selectedPin}
              onClick={() => selectPin(a)}
            >
              <span>
                {i + 1} · {a.category}
              </span>
              <span>{a.note || "Review marked area"}</span>
            </button>
          ))}
          {pin && (
            <form
              className="annotation-editor"
              data-dirty={dirty}
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  if (!version) return;
                  const saved = await repo.putAnnotation({
                    ...pin,
                    imageVersionId: version.id,
                  });
                  setPin(saved);
                  setSelectedPin(saved.id);
                  setDirty(false);
                  setMessage("Annotation saved.");
                });
              }}
            >
              <label>
                Failure category
                <select
                  aria-label="Annotation category"
                  value={pin.category}
                  onChange={(e) => {
                    setPin({
                      ...pin,
                      category: e.target.value as ImageAnnotation["category"],
                    });
                    setDirty(true);
                  }}
                >
                  {annotationCategories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Annotation note
                <textarea
                  aria-label="Annotation note"
                  value={pin.note}
                  onChange={(e) => {
                    setPin({ ...pin, note: e.target.value });
                    setDirty(true);
                  }}
                />
              </label>
              <details className="disclosure">
                <summary>Pin position</summary>
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis}>
                    {axis.toUpperCase()} (%)
                    <input
                      aria-label={`Pin ${axis} (%)`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={+(pin[axis] * 100).toFixed(1)}
                      onChange={(e) => {
                        setPin({
                          ...pin,
                          [axis]: Math.max(
                            0,
                            Math.min(1, Number(e.target.value) / 100),
                          ),
                        });
                        setDirty(true);
                      }}
                    />
                  </label>
                ))}
              </details>
              <div className="inline-actions">
                <button className="primary" disabled={busy}>
                  Save annotation
                </button>
                {pin.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await repo.removeAnnotation(pin.id!, pin.updatedAt!);
                        setPin(undefined);
                        setDirty(false);
                        setSelectedPin(undefined);
                      })
                    }
                  >
                    Remove annotation
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm("Discard unsaved annotation changes?")
                    ) {
                      setPin(undefined);
                      setDirty(false);
                    }
                  }}
                >
                  Close annotation
                </button>
              </div>
            </form>
          )}
        </section>
        <section className="review-recovery">
          <h3>Revision direction</h3>
          <label>
            Next generation instructions
            <textarea
              aria-label="Review next direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              onBlur={() => {
                if (direction !== attempt.revisionDirection)
                  void act(async () => {
                    await db.settings.put({
                      key: "reviewDirection:" + attempt.id,
                      value: direction,
                    });
                  });
              }}
            />
          </label>
          <p className="helper">
            These instructions express creative intent. Results must still be
            reviewed.
          </p>
          <details className="disclosure">
            <summary>Preservation requirements</summary>
            <ContractSummary contract={attempt.contract} />
          </details>
          <details className="disclosure">
            <summary>Retry prompt preview</summary>
            <textarea
              aria-label="Retry prompt preview"
              value={prompt}
              readOnly
              rows={8}
            />
          </details>
          <details className="disclosure">
            <summary>Full retry brief</summary>
            <textarea
              aria-label="Full retry brief"
              value={brief}
              readOnly
              rows={12}
            />
          </details>
          <div className="inline-actions">
            <button
              disabled={dirty || !checkpoint}
              onClick={() => void copy(prompt)}
            >
              Copy Retry Prompt
            </button>
            <button
              disabled={dirty || !checkpoint}
              onClick={() => void copy(brief)}
            >
              Copy Full Retry Brief
            </button>
          </div>
          {attempt.status === "REJECTED" && (
            <button
              className="primary full"
              disabled={
                busy ||
                dirty ||
                !checkpoint ||
                (!!version && version.id !== currentVersion?.id)
              }
              onClick={() =>
                void act(async () => {
                  const next = await repo.retry(attempt.id, direction);
                  onRetry(next.id);
                })
              }
            >
              Try Again from Approved Reference
            </button>
          )}
          {dirty && (
            <p className="helper">
              Save your annotation before retrying or copying the brief.
            </p>
          )}
          {attempt.status !== "REJECTED" && (
            <p className="helper">
              Notes remain available here. Keep or mark this iteration for
              revision in the Notebook.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
