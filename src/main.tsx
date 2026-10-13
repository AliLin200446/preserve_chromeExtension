import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  db,
  repo,
  failureCategories,
  exportPrompt,
  validateImage,
  type Attempt,
  type Checkpoint,
  type Stage,
  type Status,
} from "./domain";
import { createDemo } from "./demo";
import {
  ContractEditor,
  ContractSummary,
  DirectionNotes,
  Modal,
  Preview,
  SectionTitle,
  UploadControl,
} from "./NotebookPieces";
import {
  chapterStatus,
  date,
  decisionLabel,
  ordinal,
  revisionLabel,
} from "./presentation";
import { buildWorkflowGraph } from "./graph";
import { WorkflowMap, type StageActions } from "./WorkflowMap";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { Comparison } from "./Comparison";
import { ReferenceReview, hasUnsavedAnnotation } from "./ReferenceReview";
import { compileRecovery } from "./domain";
import { ConnectedCanvas } from "./ConnectedCanvas";
import { Lineage } from "./Lineage";
import "./style.css";
import "./workflow.css";
import "./review.css";
import "./notebook.css";
import { StatusBadge, NotebookEmptyState } from "./NotebookUI";
const isCanvasPage = location.pathname.endsWith("/canvas.html");
function App() {
  const [editor, setEditor] = useState<Attempt>();
  const [dirty, setDirty] = useState(false);
  const workflows = useLiveQuery(() =>
    db.workflows.orderBy("createdAt").toArray(),
  );
  const activeSetting = useLiveQuery(() => db.settings.get("activeWorkflow"));
  const workflowId =
    (dirty && editor ? editor.workflowId : activeSetting?.value) ||
    workflows?.[0]?.id ||
    "";
  const workflow = workflows?.find((w) => w.id === workflowId);
  const stages = useLiveQuery(
    () => db.stages.where({ workflowId }).sortBy("order"),
    [workflowId],
  );
  const attempts = useLiveQuery(
    () => db.attempts.where({ workflowId }).toArray(),
    [workflowId],
  );
  const checkpoints = useLiveQuery(
    () => db.checkpoints.where({ workflowId }).toArray(),
    [workflowId],
  );
  const chapterSetting = useLiveQuery(
    () => db.settings.get(`activeStage:${workflowId}`),
    [workflowId],
  );
  const latest = (attempts ?? []).reduce<Attempt | undefined>(
    (last, a) => (!last || a.createdAt > last.createdAt ? a : last),
    undefined,
  );
  const stage =
    stages?.find(
      (s) =>
        s.id === (dirty && editor ? editor.stageId : chapterSetting?.value),
    ) ||
    stages?.find((s) => s.id === latest?.stageId) ||
    stages?.[0];
  const attemptSetting = useLiveQuery(
    () => db.settings.get("activeAttempt:" + stage?.id),
    [stage?.id],
  );
  type View = "Projects" | "Workflow" | "Notebook" | "History";
  const [tab, setTabState] = useState<View>(
    () =>
      (
        ({
          projects: "Projects",
          notebook: "Notebook",
          history: "History",
        }) as Record<string, View>
      )[location.hash.slice(1)] ?? "Workflow",
  );
  const setTab = (next: View) => {
    setTabState(next);
    history.replaceState(null, "", "#" + next.toLowerCase());
  };
  const stageAttempts = (attempts ?? [])
    .filter((a) => a.stageId === stage?.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const selected =
    stageAttempts.find(
      (a) => a.id === (dirty && editor ? editor.id : attemptSetting?.value),
    ) || stageAttempts.at(-1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [listView, setListView] = useState(false);
  const [reviewId, setReviewId] = useState<string>();
  const annotationRows =
    useLiveQuery(
      () => db.annotations.where({ workflowId }).toArray(),
      [workflowId],
    ) ?? [];
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [explanation, setExplanation] = useState("");
  const [sourceId, setSourceId] = useState("auto");
  useEffect(() => {
    if (dirty) return;
    setEditor(selected ? structuredClone(selected) : undefined);
  }, [selected?.id, selected?.updatedAt, selected?.status, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save your changes. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const canLeave = () =>
    !dirty ||
    window.confirm(
      "Leave these unsaved notes behind? Choose Cancel to save them first.",
    );
  const setSelection = async (a: Attempt, notebook = true) => {
    await db.settings.bulkPut([
      { key: "activeStage:" + workflowId, value: a.stageId },
      { key: "activeAttempt:" + a.stageId, value: a.id },
    ]);
    setEditor(structuredClone(a));
    setDirty(false);
    if (notebook) setTab("Notebook");
  };
  const openAttempt = (a: Attempt) => {
    if (!canLeave()) return;
    void run(() => setSelection(a));
  };
  const activate = async (id: string, confirmed = false) => {
    if (!confirmed && !canLeave()) return;
    await db.settings.put({ key: "activeWorkflow", value: id });
    setSourceId("auto");
    setDirty(false);
    setTab("Workflow");
    window.scrollTo({ top: 0 });
  };
  const chooseStage = async (s: Stage, openNotebook = true) => {
    if (s.id === stage?.id) {
      await db.settings.put({ key: "activeStage:" + workflowId, value: s.id });
      if (openNotebook) setTab("Notebook");
      return;
    }
    if (!canLeave()) return;
    await db.settings.put({ key: "activeStage:" + workflowId, value: s.id });
    setSourceId("auto");
    setDirty(false);
    if (openNotebook) setTab("Notebook");
    window.scrollTo({ top: 0 });
  };
  const edit = (patch: Partial<Attempt>) => {
    if (editor?.status === "DRAFT") {
      setEditor({ ...editor, ...patch });
      setDirty(true);
    }
  };
  const save = async () => {
    if (editor && dirty) {
      await repo.save(editor);
      setDirty(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied. Ready for your creative tool.");
    } catch {
      throw Error(
        "Copy is unavailable. Open the structured prompt and copy the text manually.",
      );
    }
  };
  const addAttempt = async () => {
    if (!stage || !canLeave()) return;
    const cp = sourceId === "auto" ? await repo.sourceFor(stage.id) : undefined;
    await setSelection(
      await repo.addAttempt(
        stage.id,
        sourceId === "none"
          ? undefined
          : sourceId === "auto"
            ? cp?.id
            : sourceId,
      ),
    );
  };
  const upload = (file: File) =>
    void run(async () => {
      const image = await validateImage(file);
      edit({ image });
    });
  const selectedCheckpoint = checkpoints?.find(
    (c) => c.attemptId === editor?.id,
  );
  const source = checkpoints?.find((c) => c.id === editor?.sourceCheckpointId);
  const reference = editor?.sourceCheckpointId
    ? source
    : editor?.status === "APPROVED"
      ? selectedCheckpoint
      : undefined;
  const missingSource = !!editor?.sourceCheckpointId && !source;
  const current = checkpoints?.find((c) => c.id === stage?.currentCheckpointId);
  const stageIndex = stages?.findIndex((s) => s.id === stage?.id) ?? -1;
  const predecessor = stages?.[stageIndex - 1];
  const nextStage = stages?.[stageIndex + 1];
  const draft = editor?.status === "DRAFT";
  const numberOf = (a: Attempt) =>
    ordinal(
      (attempts ?? [])
        .filter((p) => p.stageId === a.stageId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .findIndex((p) => p.id === a.id) + 1,
    );
  const labelFor = (a: Attempt) =>
    `${stages?.find((s) => s.id === a.stageId)?.name ?? "Unavailable chapter"} · Iteration ${numberOf(a)}`;
  const checkpointLabel = (c: Checkpoint) => {
    const a = attempts?.find((a) => a.id === c.attemptId);
    return a ? labelFor(a) : "Unavailable iteration";
  };
  const inspectCheckpoint = (c: Checkpoint) => {
    const a = attempts?.find((a) => a.id === c.attemptId);
    if (a) openAttempt(a);
    else
      setError(
        "The original iteration is unavailable. Its kept reference is still preserved here.",
      );
  };
  const revise = async () => {
    if (!selectedCheckpoint) throw Error("This kept version is unavailable.");
    await setSelection(await repo.reviseCheckpoint(selectedCheckpoint.id));
    setNotice(
      "A new version, with the original image. Your earlier decision is preserved.",
    );
  };
  const retry = async () => {
    if (editor) await setSelection(await repo.retry(editor.id));
  };
  const beginRevision = () => {
    setCategories([]);
    setExplanation("");
    setError("");
    setFailureOpen(true);
  };
  const openReferenceReview = async (a: Attempt) => {
    await save();
    if (a.id !== editor?.id) {
      if (!canLeave()) return;
      await setSelection(a);
    }
    setReviewId(a.id);
  };
  const openReviewWorkspace = async () => {
    if (!editor) return;
    await save();
    await db.settings.bulkPut([
      { key: "activeStage:" + workflowId, value: editor.stageId },
      { key: "activeAttempt:" + editor.stageId, value: editor.id },
    ]);
    window.open(
      new URL("review.html", location.href).href,
      "_blank",
      "noopener",
    );
  };
  const showCompare = (a = editor) => {
    if (!a) return;
    const other = stageAttempts.find((p) => p.id !== a.id);
    if (!other) return;
    setCompareIds([a.id, other.id]);
    setCompareOpen(true);
  };
  const kept = (checkpoints ?? [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  const cover = kept[0]?.image;
  const lastEdited = Math.max(
    workflow?.createdAt ?? 0,
    ...(attempts ?? []).map((a) => a.updatedAt),
  );
  const reuse = async () => {
    if (editor)
      await setSelection(
        await repo.addAttempt(
          editor.stageId,
          editor.sourceCheckpointId,
          editor,
        ),
      );
  };
  const manageOrder = async (delta: number) => {
    if (!stages || !stage) return;
    const ids = stages.map((s) => s.id);
    const target = stageIndex + delta;
    [ids[target], ids[stageIndex]] = [ids[stageIndex], ids[target]];
    await repo.reorder(workflowId, ids);
  };
  const graph = buildWorkflowGraph(
    stages ?? [],
    attempts ?? [],
    checkpoints ?? [],
    stage?.id,
    editor?.id,
  );
  const openCanvas = () => {
    window.open(
      new URL("canvas.html", location.href).href,
      "_blank",
      "noopener",
    );
  };
  const stageActions: StageActions = {
    rename: (s) =>
      void run(async () => {
        const name = window.prompt("Stage title", s.name);
        if (name?.trim()) await db.stages.update(s.id, { name: name.trim() });
      }),
    move: (s, delta) =>
      void run(async () => {
        if (!stages) return;
        const ids = stages.map((s) => s.id);
        const index = ids.indexOf(s.id),
          target = index + delta;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await repo.reorder(workflowId, ids);
      }),
    addAfter: (s) =>
      void run(async () => {
        const name = window.prompt("New stage title");
        if (!name?.trim()) return;
        await db.transaction("rw", db.stages, async () => {
          const ordered = await db.stages.where({ workflowId }).sortBy("order");
          const added = await repo.addStage(workflowId, name);
          const ids = ordered.map((s) => s.id);
          ids.splice(ids.indexOf(s.id) + 1, 0, added.id);
          await repo.reorder(workflowId, ids);
        });
      }),
    remove: (s) =>
      void run(async () => {
        if (!canLeave()) return;
        if (
          window.confirm(
            "Delete “" +
              s.name +
              "” and its iterations and kept references? Linked references elsewhere will become unavailable.",
          )
        ) {
          await repo.deleteStage(s.id);
          setDirty(false);
        }
      }),
  };
  const remoteSelectionPending = !!(
    dirty &&
    editor &&
    ((activeSetting?.value && activeSetting.value !== editor.workflowId) ||
      (chapterSetting?.value && chapterSetting.value !== editor.stageId) ||
      (attemptSetting?.value && attemptSetting.value !== editor.id))
  );
  const projectActions = (
    <div className="project-actions">
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setError("");
          setCreateOpen(true);
        }}
      >
        <Plus size={16} />
        New project
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (!canLeave()) return;
            const w = await createDemo();
            await activate(w.id, true);
          })
        }
      >
        Explore a sample notebook
        <ArrowUpRight size={16} />
      </button>
    </div>
  );
  const newIteration = (
    <div className="new-iteration">
      <details className="disclosure">
        <summary>
          Choose a reference for the next iteration
          <ChevronDown size={15} />
        </summary>
        <label>
          Approved reference
          <select
            aria-label="New iteration reference"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="auto">
              Closest earlier chapter with a kept reference
            </option>
            <option value="none">Start with an original image</option>
            {kept.map((c) => (
              <option key={c.id} value={c.id}>
                {checkpointLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">
          Only kept references appear here. The chosen reference is copied into
          the new iteration.
        </p>
      </details>
      <button
        className="primary full"
        disabled={busy}
        onClick={() => void run(addAttempt)}
      >
        <Plus size={16} />
        New iteration
      </button>
    </div>
  );
  const technical = editor && (
    <details className="disclosure technical">
      <summary>
        Version details & connections
        <Plus size={15} />
      </summary>
      <dl>
        <dt>Created</dt>
        <dd>{new Date(editor.createdAt).toLocaleString()}</dd>
        <dt>Saved</dt>
        <dd>{new Date(editor.updatedAt).toLocaleString()}</dd>
        <dt>Iteration ID</dt>
        <dd>{editor.id}</dd>
        <dt>Stored decision</dt>
        <dd>{editor.status}</dd>
        <dt>Direction / requirements</dt>
        <dd>
          v{editor.prompt.version} / v{editor.contract.version}
        </dd>
        <dt>Approved source</dt>
        <dd>{editor.sourceCheckpointId ?? "Original image"}</dd>
      </dl>
      {source && (
        <button
          className="text-button"
          onClick={() => inspectCheckpoint(source)}
        >
          Open approved reference
          <ArrowUpRight size={14} />
        </button>
      )}
      {editor.previousAttemptId && (
        <p>
          Previous iteration:{" "}
          <button
            className="text-button"
            onClick={() => {
              const previous = attempts?.find(
                (a) => a.id === editor.previousAttemptId,
              );
              if (previous) openAttempt(previous);
              else setError("The previous iteration is no longer available.");
            }}
          >
            {attempts?.find((a) => a.id === editor.previousAttemptId)
              ? labelFor(
                  attempts.find((a) => a.id === editor.previousAttemptId)!,
                )
              : "Unavailable iteration"}
          </button>
        </p>
      )}
    </details>
  );
  return (
    <div
      className={`notebook ${tab === "Notebook" ? "notebook-view" : ""} ${tab === "Workflow" ? "map-mode" : "paper-mode"} ${isCanvasPage ? "canvas-page" : "panel-page"} ${tab === "Workflow" && !listView ? "graph-mode" : ""}`}
    >
      <header className="masthead">
        <div className="brand-row">
          <a
            className="wordmark"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setTab("Projects");
            }}
          >
            PRESERVE
          </a>
          {workflows?.length ? (
            <select
              aria-label="Active project"
              disabled={busy}
              value={workflow?.id ?? ""}
              onChange={(e) => void run(() => activate(e.target.value))}
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          ) : (
            <BookOpen size={22} strokeWidth={1} />
          )}
        </div>
        <nav aria-label="Notebook navigation">
          {(["Projects", "Workflow", "Notebook"] as const).map((t) => (
            <button
              key={t}
              disabled={busy}
              aria-current={
                tab === t || (t === "Notebook" && tab === "History")
                  ? "page"
                  : undefined
              }
              className={
                tab === t || (t === "Notebook" && tab === "History")
                  ? "active"
                  : ""
              }
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      {error && !createOpen && !failureOpen && (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setError("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {remoteSelectionPending && (
        <div className="selection-notice" role="status">
          <p>
            Another view selected a different stage or iteration. Your unsaved
            notes are safe here.
          </p>
          <div>
            <button disabled={busy} onClick={() => void run(save)}>
              Save & follow selection
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (editor)
                    await db.settings.bulkPut([
                      { key: "activeWorkflow", value: editor.workflowId },
                      {
                        key: "activeStage:" + editor.workflowId,
                        value: editor.stageId,
                      },
                      {
                        key: "activeAttempt:" + editor.stageId,
                        value: editor.id,
                      },
                    ]);
                })
              }
            >
              Keep working here
            </button>
          </div>
        </div>
      )}
      <main aria-busy={busy}>
        {!workflows ? (
          <div className="empty-state">Opening your notebook…</div>
        ) : !workflow ? (
          <section className="welcome">
            <span className="eyebrow">A notebook for the work in progress</span>
            <div className="empty-cover">
              <BookOpen size={48} strokeWidth={0.8} />
              <span>
                Ideas. Images.
                <br />
                And everything in between.
              </span>
            </div>
            <h1>
              Make room
              <br />
              for the process.
            </h1>
            <p>
              Keep the images that work. Leave a note about the ones that don't.
              Give your next idea somewhere to begin.
            </p>
            {projectActions}
            <p className="helper">
              Private, local, and yours. No account needed.
            </p>
          </section>
        ) : (
          <>
            {tab === "Workflow" && !isCanvasPage && (
              <div className="workflow-view-switch">
                <button
                  aria-pressed={!listView}
                  onClick={() => setListView(false)}
                >
                  Canvas
                </button>
                <button
                  aria-pressed={listView}
                  onClick={() => setListView(true)}
                >
                  List
                </button>
                {!listView && (
                  <>
                    <button className="text-button" onClick={openCanvas}>
                      Open Canvas
                      <ArrowUpRight size={14} />
                    </button>
                  </>
                )}
              </div>
            )}
            {tab === "Workflow" &&
              (!listView || isCanvasPage ? (
                <WorkflowCanvas
                  key={workflowId}
                  checkpoints={checkpoints ?? []}
                  busy={busy}
                  actions={stageActions}
                  onAdd={() =>
                    void run(async () => {
                      const name = window.prompt("New stage title");
                      if (name?.trim()) await repo.addStage(workflowId, name);
                    })
                  }
                  onMove={(id, position) =>
                    void run(() => repo.moveNode(id, position))
                  }
                  onInspect={(a, notebook = false) => {
                    if (canLeave()) void run(() => setSelection(a, notebook));
                  }}
                  onBranch={(a) =>
                    void run(async () => {
                      if (!canLeave()) return;
                      await save();
                      await setSelection(await repo.branch(a.id));
                    })
                  }
                  onReturn={(cp, target, parent) =>
                    void run(async () => {
                      if (!canLeave()) return;
                      await save();
                      await setSelection(
                        await repo.returnToCheckpoint(cp, target, parent),
                      );
                    })
                  }
                  nodes={graph.nodes}
                  edges={graph.edges}
                  selectedId={stage?.id}
                  onSelect={(s) => void run(() => chooseStage(s, false))}
                  onOpen={(s) => void run(() => chooseStage(s))}
                />
              ) : (
                <>
                  <WorkflowMap
                    nodes={graph.nodes}
                    selectedId={stage?.id}
                    onOpen={(s) => void run(() => chooseStage(s))}
                    onCanvas={openCanvas}
                    actions={stageActions}
                    busy={busy}
                  />
                  <button
                    className="full"
                    onClick={() =>
                      void run(async () => {
                        const name = window.prompt("New stage title");
                        if (name?.trim()) await repo.addStage(workflowId, name);
                      })
                    }
                  >
                    <Plus size={16} />
                    Add stage
                  </button>
                </>
              ))}
            {(tab === "Notebook" || tab === "History") && (
              <div className="notebook-toolbar">
                <button
                  className="text-button"
                  onClick={() => setTab("Workflow")}
                >
                  <ArrowLeft size={15} />
                  Back to workflow
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setTab(tab === "History" ? "Notebook" : "History")
                  }
                >
                  {tab === "History" ? "Stage notebook" : "Version history"}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            {tab === "Projects" && (
              <section className="project-cover">
                <div className="running-label">
                  <span>Your creative notebooks</span>
                  <span>
                    {workflow.sample ? "Sample project" : "Personal project"}
                  </span>
                </div>
                <h1>{workflow.name}</h1>
                <p className="cover-objective">
                  {workflow.objective ||
                    "An idea taking shape, one image at a time."}
                </p>
                {cover && (
                  <figure>
                    <Preview
                      blob={cover}
                      label={`${workflow.name} — last kept image`}
                    />
                    <figcaption>
                      Cover image · the most recently kept reference
                    </figcaption>
                  </figure>
                )}
                <p>
                  {workflow.description ||
                    "A place for your references, experiments, and the decisions between them."}
                </p>
                <dl className="cover-meta">
                  <div>
                    <dt>Chapters</dt>
                    <dd>{stages?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Last edited</dt>
                    <dd>{date(lastEdited)}</dd>
                  </div>
                </dl>
                {stage ? (
                  <button
                    className="primary full"
                    onClick={() => setTab("Notebook")}
                  >
                    Continue {stage.name}
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="primary full"
                    onClick={() =>
                      void run(async () => {
                        const s = await repo.addStage(
                          workflowId,
                          "First chapter",
                        );
                        await chooseStage(s);
                      })
                    }
                  >
                    Add your first chapter
                    <Plus size={16} />
                  </button>
                )}
                <p className="helper">
                  {stage
                    ? `Current chapter · ${ordinal(stageIndex + 1)} / ${stage.name}`
                    : "Your project is ready for a new chapter."}
                </p>
                <details className="disclosure">
                  <summary>
                    About this project
                    <Plus size={15} />
                  </summary>
                  <p>{workflow.platform || "Any creative platform"}</p>
                  <p className="helper">
                    Started {date(workflow.createdAt)}. All images and notes are
                    stored in this browser.
                  </p>
                </details>
                <section className="project-library">
                  <h2>Open another notebook</h2>
                  {workflows.map((w) => (
                    <button
                      className="project-link"
                      key={w.id}
                      disabled={busy}
                      onClick={() => void run(() => activate(w.id))}
                    >
                      <span>
                        {w.name}
                        <small>
                          {w.sample ? "Sample notebook" : date(w.createdAt)}
                        </small>
                      </span>
                      {w.id === workflowId ? (
                        <Check size={16} />
                      ) : (
                        <ArrowUpRight size={16} />
                      )}
                    </button>
                  ))}
                </section>
                {projectActions}
              </section>
            )}
            {tab === "Notebook" && (
              <>
                <p className="project-heading">{workflow.name}</p>
                {stage ? (
                  <>
                    <div className="chapter-heading">
                      <h1>
                        <span>Stage {ordinal(stageIndex + 1)} / </span>
                        {stage.name}
                      </h1>
                      <p className="stage-progress">
                        <StatusBadge
                          tone={
                            stage.status === "Approved"
                              ? "sage"
                              : stage.status === "Needs Revision"
                                ? "rust"
                                : stage.status === "In Progress"
                                  ? "blue"
                                  : "neutral"
                          }
                        >
                          {chapterStatus[stage.status]}
                        </StatusBadge>
                      </p>
                      {editor && (
                        <div className="recovery-shortcuts">
                          <button
                            className={
                              editor.status === "REJECTED" ? "primary" : ""
                            }
                            disabled={busy}
                            onClick={() =>
                              void run(() => openReferenceReview(editor))
                            }
                          >
                            Compare with Reference
                          </button>
                        </div>
                      )}
                      <details className="chapter-controls disclosure">
                        <summary
                          aria-label="Stage options"
                          title="Stage options"
                        >
                          <MoreHorizontal size={20} />
                        </summary>
                        <div className="control-list">
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const name = window.prompt(
                                  "Chapter title",
                                  stage.name,
                                );
                                if (name?.trim())
                                  await db.stages.update(stage.id, {
                                    name: name.trim(),
                                  });
                              })
                            }
                          >
                            Rename chapter
                          </button>
                          <button
                            disabled={busy || stageIndex === 0}
                            onClick={() => void run(() => manageOrder(-1))}
                          >
                            Move chapter earlier
                          </button>
                          <button
                            disabled={
                              busy || stageIndex === (stages?.length ?? 0) - 1
                            }
                            onClick={() => void run(() => manageOrder(1))}
                          >
                            Move chapter later
                          </button>
                          <button
                            className="danger-text"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                if (!canLeave()) return;
                                if (
                                  window.confirm(
                                    `Delete “${stage.name}” and all its iterations and kept references? Later references to this chapter will become unavailable.`,
                                  )
                                ) {
                                  await repo.deleteStage(stage.id);
                                  setDirty(false);
                                }
                              })
                            }
                          >
                            Delete chapter
                          </button>
                        </div>
                        <label>
                          Chapter progress
                          <select
                            aria-label="Chapter progress"
                            value={stage.status}
                            onChange={(e) =>
                              void run(async () => {
                                const status = e.target.value as Status;
                                if (
                                  status === "Approved" &&
                                  !stage.currentCheckpointId
                                )
                                  throw Error(
                                    "Keep an iteration first to establish an approved reference.",
                                  );
                                await db.stages.update(stage.id, { status });
                              })
                            }
                          >
                            {Object.entries(chapterStatus).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <p className="helper">
                          Previous chapter:{" "}
                          {predecessor?.name ?? "This is the beginning."}
                        </p>
                      </details>
                    </div>
                    <details className="chapter-index">
                      <summary>
                        <span>Browse stages · {stages?.length ?? 0}</span>
                        <span>
                          Index
                          <ChevronDown size={15} />
                        </span>
                      </summary>
                      <div className="chapter-links">
                        {stages?.map((s, i) => (
                          <button
                            key={s.id}
                            aria-current={
                              s.id === stage?.id ? "step" : undefined
                            }
                            onClick={() => void run(() => chooseStage(s))}
                          >
                            <span>{ordinal(i + 1)}</span>
                            <span>
                              {s.name}
                              <small>{chapterStatus[s.status]}</small>
                            </span>
                            {s.id === stage?.id && <Check size={16} />}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const name = window.prompt("Name your new chapter");
                            if (name?.trim()) {
                              const s = await repo.addStage(workflowId, name);
                              await chooseStage(s);
                            }
                          })
                        }
                      >
                        <Plus size={15} />
                        Add chapter
                      </button>
                    </details>
                    <section className="chapter-section reference-section">
                      <SectionTitle number="01" title="Approved Reference" />
                      <p className="section-intro">
                        The kept image and requirements guiding this stage.
                      </p>
                      {source && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await save();
                              await setSelection(
                                await repo.returnToCheckpoint(
                                  source.id,
                                  stage.id,
                                  editor?.id,
                                ),
                              );
                            })
                          }
                        >
                          Return to this checkpoint
                          <RotateCcw size={14} />
                        </button>
                      )}
                      {reference ? (
                        <>
                          <figure>
                            <Preview
                              blob={reference.image}
                              label={`Approved reference — ${checkpointLabel(reference)}`}
                            />
                            <figcaption>
                              <span>Kept reference</span>
                              <button
                                className="caption-link"
                                onClick={() => inspectCheckpoint(reference)}
                              >
                                {checkpointLabel(reference)}
                                <ArrowUpRight size={13} />
                              </button>
                            </figcaption>
                          </figure>
                          {!editor?.sourceCheckpointId && (
                            <p className="helper">
                              An original reference, kept in this chapter.
                            </p>
                          )}
                          <details className="disclosure">
                            <summary>Reference requirements</summary>
                            <ContractSummary
                              contract={editor?.contract ?? reference.contract}
                            />
                          </details>
                          {editor?.contract.knownFailurePoints && (
                            <div className="written-note">
                              <h3>Known failure points</h3>
                              <p>{editor.contract.knownFailurePoints}</p>
                            </div>
                          )}
                          {editor?.prompt.reference && (
                            <div className="reference-usage">
                              <h3>Reference direction</h3>
                              <p>{editor.prompt.reference}</p>
                            </div>
                          )}
                        </>
                      ) : missingSource ? (
                        <div className="recovery">
                          <h3>This reference is no longer available.</h3>
                          <p>
                            The original chapter or kept image was removed. This
                            iteration and its notes are still here. Choose
                            another kept reference when starting a new iteration
                            below.
                          </p>
                          <button
                            className="text-button"
                            onClick={() =>
                              document
                                .getElementById("next-step")
                                ?.scrollIntoView()
                            }
                          >
                            Choose a new starting point
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      ) : (
                        <div className="empty-reference">
                          <p>
                            {editor
                              ? "An original image starts this chapter. Upload an output below, then keep the version you want to return to."
                              : "Begin with a kept reference from another chapter, or upload an original image."}
                          </p>
                          <button
                            className={editor ? "text-button" : "primary"}
                            onClick={() =>
                              document
                                .getElementById(
                                  editor ? "iterations" : "next-step",
                                )
                                ?.scrollIntoView()
                            }
                          >
                            {editor
                              ? "Go to your images"
                              : "Start an iteration"}
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                    </section>
                    <section
                      className="chapter-section current-section"
                      id="current-iteration"
                    >
                      <SectionTitle number="02" title="Current Iteration" />
                      <p className="section-intro">
                        Work on this version, then compare it with your
                        reference.
                      </p>
                      {editor?.externalSource && (
                        <details className="disclosure">
                          <summary>
                            Imported from FLORA ·{" "}
                            {editor.externalSource.projectName}
                          </summary>
                          <p>Source node: {editor.externalSource.nodeId}</p>
                          <p>
                            Model:{" "}
                            {editor.externalSource.model ?? "Not exposed"}
                          </p>
                          <p>
                            {editor.externalSource.prompt ??
                              "Prompt not exposed"}
                          </p>
                          <p className="helper">
                            Platform edges are retained as provenance, not
                            approved reference links.
                          </p>
                          <pre>
                            {JSON.stringify(editor.externalSource, null, 2)}
                          </pre>
                        </details>
                      )}
                      {editor && (
                        <div className="iteration-detail" id="iteration-detail">
                          <div className="detail-heading">
                            <h3>Iteration {numberOf(editor)}</h3>
                            <StatusBadge
                              tone={
                                editor.status === "APPROVED"
                                  ? "sage"
                                  : editor.status === "REJECTED"
                                    ? "rust"
                                    : "blue"
                              }
                            >
                              {decisionLabel[editor.status]}
                            </StatusBadge>
                          </div>
                          {editor.image && (
                            <Preview
                              blob={editor.image}
                              label={`Selected iteration ${numberOf(editor)}`}
                            />
                          )}
                          <div className="inline-actions">
                            {draft && (
                              <UploadControl
                                onUpload={upload}
                                replace={!!editor.image}
                                disabled={busy}
                              />
                            )}
                            <button
                              className="text-button"
                              disabled={stageAttempts.length < 2}
                              onClick={() => showCompare()}
                            >
                              Compare images
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                          {draft && !editor.image && (
                            <NotebookEmptyState title="Ready for your first image">
                              Upload a PNG, JPEG, or WebP up to 15 MB. Keep your
                              reference above; add the new output here.
                            </NotebookEmptyState>
                          )}
                          <label>
                            Notes on this image
                            <textarea
                              aria-label="Notes on this image"
                              rows={2}
                              readOnly={!draft}
                              placeholder="A detail to remember. Something to revisit."
                              value={editor.notes}
                              onChange={(e) => edit({ notes: e.target.value })}
                            />
                          </label>
                          <details className="disclosure">
                            <summary>
                              Making details
                              <Plus size={15} />
                            </summary>
                            <label>
                              Model / platform
                              <input
                                aria-label="Model / platform"
                                readOnly={!draft}
                                value={editor.platform}
                                onChange={(e) =>
                                  edit({ platform: e.target.value })
                                }
                              />
                            </label>
                            <p className="helper">
                              {date(editor.createdAt)} ·{" "}
                              {workflow.sample
                                ? "Illustrative sample project"
                                : "Manually uploaded output"}
                            </p>
                          </details>
                          {editor && stage && (
                            <Lineage
                              attempts={attempts ?? []}
                              checkpoints={checkpoints ?? []}
                              stages={stages ?? []}
                              stageId={stage.id}
                              selectedId={editor.id}
                              onOpen={openAttempt}
                            />
                          )}
                          <div className="inline-actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await save();
                                  await setSelection(
                                    await repo.branch(editor.id),
                                  );
                                })
                              }
                            >
                              Branch this iteration
                            </button>
                          </div>
                          {technical}
                        </div>
                      )}
                      {!editor && (
                        <NotebookEmptyState
                          title="A fresh page for this stage"
                          action={
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() => void run(addAttempt)}
                            >
                              <Plus size={16} />
                              Start the first iteration
                            </button>
                          }
                        >
                          Start with a reference or an original image. Each
                          version will have its own place here.
                        </NotebookEmptyState>
                      )}
                    </section>
                    <section className="chapter-section" id="compare-reference">
                      <SectionTitle number="03" title="Compare & Annotate" />
                      <p className="section-intro">
                        Look closely. Mark the details you want to change.
                      </p>
                      <ConnectedCanvas
                        key={stage.id}
                        stageId={stage.id}
                        workflowId={workflowId}
                        attempt={editor}
                        dirty={dirty}
                        onImported={async (a) => {
                          await db.settings.bulkPut([
                            { key: "activeWorkflow", value: a.workflowId },
                            {
                              key: "activeStage:" + a.workflowId,
                              value: a.stageId,
                            },
                            { key: "activeAttempt:" + a.stageId, value: a.id },
                          ]);
                          setEditor(structuredClone(a));
                          setDirty(false);
                        }}
                      />
                      <div className="notebook-review-actions">
                        <button
                          className="secondary"
                          disabled={!editor || busy}
                          onClick={() =>
                            editor &&
                            void run(() => openReferenceReview(editor))
                          }
                        >
                          Review images
                        </button>
                        <button
                          className="text-button"
                          disabled={!editor || busy}
                          onClick={() => void run(openReviewWorkspace)}
                        >
                          Open Review Workspace ↗
                        </button>
                      </div>
                    </section>
                    <section
                      className="chapter-section"
                      id="revision-direction"
                    >
                      <SectionTitle number="04" title="Revision Direction" />
                      <p className="section-intro">
                        Keep what works. Describe the next change.
                      </p>
                      <details className="disclosure direction-details">
                        <summary>
                          Direction & prompts
                          <Plus size={15} />
                        </summary>
                        {editor ? (
                          <DirectionNotes
                            key={editor.id}
                            attempt={editor}
                            onChange={edit}
                            onCopy={(text) => void run(() => copy(text))}
                          />
                        ) : (
                          <p className="helper">
                            Start an iteration to write the direction for your
                            image.
                          </p>
                        )}
                      </details>
                      {editor && (
                        <ContractEditor
                          attempt={editor}
                          onChange={edit}
                          onRevise={() => void run(revise)}
                        />
                      )}

                      {editor?.revisionContext && (
                        <>
                          <p className="written-note">
                            Previous failure:{" "}
                            {editor.revisionContext.failure?.explanation}
                            <br />
                            {editor.revisionContext.annotations
                              .map((a) => a.category + ": " + a.note)
                              .join(" · ")}
                          </p>
                          <label>
                            Next generation instructions
                            <textarea
                              aria-label="Next generation instructions"
                              value={editor.revisionDirection ?? ""}
                              readOnly={!draft}
                              onChange={(e) =>
                                edit({ revisionDirection: e.target.value })
                              }
                            />
                          </label>
                          <details className="disclosure">
                            <summary>Retry prompt preview</summary>
                            <textarea
                              readOnly
                              aria-label="Retry prompt preview"
                              rows={8}
                              value={compileRecovery(
                                editor,
                                source
                                  ? checkpointLabel(source)
                                  : "Unavailable reference",
                                [],
                                true,
                              )}
                            />
                          </details>
                          <details className="disclosure">
                            <summary>Full retry brief</summary>
                            <textarea
                              readOnly
                              aria-label="Full retry brief"
                              rows={12}
                              value={compileRecovery(
                                editor,
                                source
                                  ? checkpointLabel(source)
                                  : "Unavailable reference",
                              )}
                            />
                          </details>
                          <div className="inline-actions">
                            <button
                              onClick={() =>
                                void run(() =>
                                  copy(
                                    compileRecovery(
                                      editor,
                                      source
                                        ? checkpointLabel(source)
                                        : "Unavailable reference",
                                      [],
                                      true,
                                    ),
                                  ),
                                )
                              }
                            >
                              Copy Retry Prompt
                            </button>
                            <button
                              onClick={() =>
                                void run(() =>
                                  copy(
                                    compileRecovery(
                                      editor,
                                      source
                                        ? checkpointLabel(source)
                                        : "Unavailable reference",
                                    ),
                                  ),
                                )
                              }
                            >
                              Copy Full Retry Brief
                            </button>
                          </div>
                        </>
                      )}
                    </section>
                    <section className="chapter-section" id="decision">
                      <SectionTitle number="05" title="Retry / Keep" />
                      <p className="section-intro">
                        Choose what to carry forward. Earlier versions stay
                        saved.
                      </p>
                      {editor ? (
                        <>
                          {(editor.failure || editor.previousFailure) && (
                            <div className="revision-note">
                              <span className="eyebrow">
                                {editor.failure
                                  ? "Revision note"
                                  : "From the previous iteration"}
                              </span>
                              <h3>What didn't work?</h3>
                              <ul>
                                {(
                                  editor.failure ?? editor.previousFailure
                                )?.categories.map((c) => (
                                  <li key={c}>{revisionLabel[c] ?? c}</li>
                                ))}
                              </ul>
                              <p>
                                {
                                  (editor.failure ?? editor.previousFailure)
                                    ?.explanation
                                }
                              </p>
                            </div>
                          )}
                          {draft ? (
                            <>
                              <p>
                                What feels right? Keep this image as a
                                reference, or leave a note for the next
                                iteration.
                              </p>
                              <div className="decision-actions">
                                <button
                                  className="primary"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await save();
                                      await repo.approve(editor.id);
                                      setNotice(
                                        "Kept. This is now the approved reference for this chapter.",
                                      );
                                    })
                                  }
                                >
                                  <Check size={16} />
                                  Keep this version
                                </button>
                                <button
                                  className="caution"
                                  disabled={busy}
                                  onClick={beginRevision}
                                >
                                  What didn't work?
                                </button>
                              </div>
                            </>
                          ) : editor.status === "APPROVED" ? (
                            <div className="kept-decision">
                              <Check size={20} />
                              <div>
                                <h3>
                                  {current?.attemptId === editor.id
                                    ? "A reference worth keeping."
                                    : "An earlier kept version."}
                                </h3>
                                <p>
                                  {current?.attemptId === editor.id
                                    ? "This is the current approved reference for this chapter."
                                    : "This approval remains in your notebook. A newer reference is currently selected for this chapter."}
                                </p>
                                <button
                                  className="text-button"
                                  onClick={() => void run(revise)}
                                >
                                  Revise this kept version
                                  <ArrowUpRight size={15} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="helper">
                              This iteration stays in your contact sheet. Its
                              notes can guide what comes next.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="helper">
                          Your decisions will live alongside the images that
                          inspired them.
                        </p>
                      )}
                    </section>
                    <section
                      className="chapter-section next-section"
                      id="next-step"
                    >
                      <h3>Continue from a kept reference</h3>
                      {editor?.status === "REJECTED" ? (
                        <>
                          <div className="retry-context">
                            <span className="eyebrow">
                              Last approved reference
                            </span>
                            <h3>
                              {source
                                ? checkpointLabel(source)
                                : "No approved reference available"}
                            </h3>
                            {source && (
                              <button
                                className="text-button"
                                onClick={() => inspectCheckpoint(source)}
                              >
                                Open kept reference
                                <ArrowUpRight size={14} />
                              </button>
                            )}
                            <div className="failed-iteration-context">
                              <h3>
                                Failed iteration{" "}
                                {editor ? numberOf(editor) : ""}
                              </h3>
                              {editor?.image && (
                                <Preview
                                  blob={editor.image}
                                  label="Failed iteration"
                                  small
                                />
                              )}
                              <p>
                                What didn't work:{" "}
                                {editor?.failure?.categories
                                  .map((c) => revisionLabel[c] ?? c)
                                  .join(" · ")}
                              </p>
                            </div>
                            <h3>Next direction</h3>
                            <p>
                              Keep the approved identity and revisit only what
                              this chapter needs to change.
                            </p>
                          </div>
                          {source ? (
                            <button
                              className="primary full"
                              disabled={busy}
                              onClick={() => void run(retry)}
                            >
                              <RotateCcw size={16} />
                              Try again from approved reference
                            </button>
                          ) : (
                            <p className="helper">
                              Select a kept reference below to begin again. The
                              original revision note will stay in the notebook.
                            </p>
                          )}
                        </>
                      ) : editor?.status === "APPROVED" &&
                        selectedCheckpoint ? (
                        <>
                          <p>
                            Take what works into the next image, or explore
                            another direction here.
                          </p>
                          <button
                            className="primary full"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                if (!selectedCheckpoint) return;
                                await setSelection(
                                  await repo.restore(selectedCheckpoint.id),
                                );
                              })
                            }
                          >
                            <RotateCcw size={16} />
                            Try again from this version
                          </button>
                        </>
                      ) : editor ? (
                        <p>
                          Continue shaping this iteration. Save your notes
                          before leaving the notebook.
                        </p>
                      ) : null}
                      {editor?.retryBrief !== undefined && (
                        <details className="disclosure">
                          <summary>
                            Edit next direction
                            <Plus size={15} />
                          </summary>
                          <textarea
                            aria-label="Next direction"
                            rows={12}
                            value={editor.retryBrief}
                            readOnly={!draft}
                            onChange={(e) =>
                              edit({ retryBrief: e.target.value })
                            }
                          />
                          <button
                            className="text-button"
                            onClick={() =>
                              void run(() => copy(editor.retryBrief ?? ""))
                            }
                          >
                            <Copy size={15} />
                            Copy next direction
                          </button>
                          <p className="helper">
                            A deterministic brief from the approved source and
                            your revision note.
                          </p>
                        </details>
                      )}
                      {editor && !draft && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void run(reuse)}
                        >
                          Reuse these direction notes
                          <Copy size={15} />
                        </button>
                      )}
                      {newIteration}
                    </section>
                    <section className="chapter-section" id="iterations">
                      <SectionTitle
                        number="06"
                        title="History & details"
                        aside={
                          <span className="section-count">
                            {stageAttempts.length}
                          </span>
                        }
                      />
                      {stageAttempts.length ? (
                        <>
                          <div className="contact-sheet">
                            {stageAttempts.map((a) => (
                              <article
                                className={`contact-item ${editor?.id === a.id ? "selected" : ""}`}
                                key={a.id}
                              >
                                <button
                                  className="contact-open"
                                  aria-label={`Open iteration ${numberOf(a)}: ${decisionLabel[a.status]}`}
                                  aria-pressed={editor?.id === a.id}
                                  onClick={() => openAttempt(a)}
                                >
                                  <Preview
                                    blob={
                                      a.id === editor?.id
                                        ? editor.image
                                        : a.image
                                    }
                                    label={`Iteration ${numberOf(a)}`}
                                    small
                                  />
                                  <div className="contact-caption">
                                    <strong>{numberOf(a)}</strong>
                                    <span
                                      className={`decision-text ${a.status.toLowerCase()}`}
                                    >
                                      {decisionLabel[a.status]}
                                    </span>
                                  </div>
                                  <time
                                    className="iteration-date"
                                    dateTime={new Date(
                                      a.createdAt,
                                    ).toISOString()}
                                  >
                                    {date(a.createdAt)}
                                  </time>
                                  <p>
                                    {a.failure?.explanation ||
                                      a.notes ||
                                      a.prompt.subject ||
                                      "An unfinished idea"}
                                  </p>
                                  {!a.image && (
                                    <span className="upload-hint">
                                      Open to upload an image
                                      <ArrowUpRight size={12} />
                                    </span>
                                  )}
                                </button>
                                <span className="contact-annotation-count">
                                  {
                                    annotationRows.filter(
                                      (p) => p.attemptId === a.id,
                                    ).length
                                  }{" "}
                                  annotations
                                </span>
                                <div className="contact-actions">
                                  <button
                                    aria-label={`Compare iteration ${numberOf(a)} with reference`}
                                    onClick={() =>
                                      void run(() => openReferenceReview(a))
                                    }
                                  >
                                    Compare reference
                                  </button>
                                  <button
                                    aria-label={`Compare iteration ${numberOf(a)} with another`}
                                    disabled={stageAttempts.length < 2}
                                    onClick={() => showCompare(a)}
                                  >
                                    Compare another
                                  </button>
                                  {a.status === "DRAFT" && (
                                    <>
                                      <button
                                        disabled={busy || !a.image}
                                        onClick={() =>
                                          void run(async () => {
                                            await save();
                                            await repo.approve(a.id);
                                          })
                                        }
                                      >
                                        Keep {numberOf(a)}
                                      </button>
                                      <button
                                        disabled={busy}
                                        onClick={() =>
                                          void run(async () => {
                                            await save();
                                            await setSelection(a);
                                            beginRevision();
                                          })
                                        }
                                      >
                                        Revise {numberOf(a)}
                                      </button>
                                    </>
                                  )}
                                  {a.status === "REJECTED" && (
                                    <button
                                      disabled={busy || !a.sourceCheckpointId}
                                      onClick={() =>
                                        void run(async () => {
                                          if (!canLeave()) return;
                                          await setSelection(
                                            await repo.retry(a.id),
                                          );
                                        })
                                      }
                                    >
                                      Retry {numberOf(a)}
                                    </button>
                                  )}
                                </div>
                              </article>
                            ))}
                          </div>
                        </>
                      ) : (
                        <NotebookEmptyState
                          title="Your process will collect here"
                          action={
                            <button
                              className="text-button"
                              onClick={() =>
                                document
                                  .getElementById("current-iteration")
                                  ?.scrollIntoView()
                              }
                            >
                              Go to Current Iteration
                              <ArrowUpRight size={15} />
                            </button>
                          }
                        >
                          Each iteration, decision, and revision note will stay
                          available as you work.
                        </NotebookEmptyState>
                      )}
                    </section>
                    <div className="chapter-pagination">
                      <button
                        disabled={!predecessor || busy}
                        onClick={() =>
                          predecessor &&
                          void run(() => chooseStage(predecessor))
                        }
                      >
                        <ArrowLeft size={16} />
                        <span>Previous chapter</span>
                      </button>
                      <button
                        disabled={!nextStage || busy}
                        onClick={() =>
                          nextStage && void run(() => chooseStage(nextStage))
                        }
                      >
                        <span>Next chapter</span>
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <h2>A new chapter awaits.</h2>
                    <button
                      className="primary"
                      onClick={() =>
                        void run(async () => {
                          const s = await repo.addStage(
                            workflowId,
                            "First chapter",
                          );
                          await chooseStage(s);
                        })
                      }
                    >
                      Add your first chapter
                    </button>
                  </div>
                )}
              </>
            )}
            {tab === "History" && (
              <section className="notes-view">
                <div className="running-label">
                  <span>Collected along the way</span>
                  <span>
                    {workflow.sample ? "Sample notebook" : "Your notebook"}
                  </span>
                </div>
                <h1>Notes & decisions</h1>
                <p className="section-intro">
                  The references you kept, the directions you explored, and how
                  one image led to the next.
                </p>
                <h2 className="collection-title">
                  Kept versions <span>{kept.length}</span>
                </h2>
                {kept.length ? (
                  kept.map((c) => (
                    <article className="kept-entry" key={c.id}>
                      <Preview blob={c.image} label={checkpointLabel(c)} />
                      <div className="entry-heading">
                        <h3>{checkpointLabel(c)}</h3>
                        <span className="decision-text approved">
                          {stages?.find((s) => s.id === c.stageId)
                            ?.currentCheckpointId === c.id
                            ? "Current reference"
                            : "Earlier reference"}
                        </span>
                      </div>
                      <p className="helper">Kept {date(c.createdAt)}</p>
                      <div className="inline-actions">
                        <button
                          className="text-button"
                          onClick={() => inspectCheckpoint(c)}
                        >
                          Open version
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (!canLeave()) return;
                              await setSelection(await repo.restore(c.id));
                            })
                          }
                        >
                          Restore as a new iteration
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="helper">
                    Your first kept image will appear here.
                  </p>
                )}
                <h2 className="collection-title">Version history</h2>
                {(attempts ?? [])
                  .slice()
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((a) => (
                    <article className="history-entry" key={a.id}>
                      <button
                        className="history-open"
                        onClick={() => openAttempt(a)}
                      >
                        <Preview blob={a.image} label={labelFor(a)} small />
                        <span>
                          <strong>{labelFor(a)}</strong>
                          <span
                            className={`decision-text ${a.status.toLowerCase()}`}
                          >
                            {decisionLabel[a.status]}
                          </span>
                        </span>
                      </button>
                      <p>
                        {a.failure?.explanation ||
                          a.notes ||
                          a.prompt.subject ||
                          "An idea in progress."}
                      </p>
                      {a.failure && (
                        <ul className="revision-categories">
                          {a.failure.categories.map((c) => (
                            <li key={c}>{revisionLabel[c] ?? c}</li>
                          ))}
                        </ul>
                      )}
                      <details className="disclosure">
                        <summary>
                          Direction & connections
                          <Plus size={14} />
                        </summary>
                        <p>
                          Approved source:{" "}
                          {a.sourceCheckpointId ? (
                            <button
                              className="text-button"
                              onClick={() => {
                                const cp = checkpoints?.find(
                                  (c) => c.id === a.sourceCheckpointId,
                                );
                                if (cp) inspectCheckpoint(cp);
                                else
                                  setError(
                                    "This approved reference is no longer available.",
                                  );
                              }}
                            >
                              {checkpoints?.find(
                                (c) => c.id === a.sourceCheckpointId,
                              )
                                ? checkpointLabel(
                                    checkpoints.find(
                                      (c) => c.id === a.sourceCheckpointId,
                                    )!,
                                  )
                                : "Unavailable reference"}
                            </button>
                          ) : (
                            "Original image"
                          )}
                        </p>
                        {a.previousAttemptId && (
                          <p>
                            Follows:{" "}
                            <button
                              className="text-button"
                              onClick={() => {
                                const p = attempts?.find(
                                  (p) => p.id === a.previousAttemptId,
                                );
                                if (p) openAttempt(p);
                                else
                                  setError("Previous iteration unavailable.");
                              }}
                            >
                              {attempts?.find(
                                (p) => p.id === a.previousAttemptId,
                              )
                                ? labelFor(
                                    attempts.find(
                                      (p) => p.id === a.previousAttemptId,
                                    )!,
                                  )
                                : "Unavailable iteration"}
                            </button>
                          </p>
                        )}
                        <pre>{exportPrompt(a.prompt, a.contract)}</pre>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run(() =>
                              copy(exportPrompt(a.prompt, a.contract)),
                            )
                          }
                        >
                          <Copy size={15} />
                          Copy prompt
                        </button>
                        <p className="technical-id">
                          {date(a.createdAt)} · {a.id}
                        </p>
                      </details>
                    </article>
                  ))}
              </section>
            )}
          </>
        )}
      </main>
      {dirty && editor && (
        <div className="save-dock">
          <span>Notes not yet saved</span>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await save();
                setNotice("Saved in your notebook.");
              })
            }
          >
            Save notes
            <Check size={15} />
          </button>
        </div>
      )}
      <footer>
        <span>Only on this device</span>
        <span>Visual workflow notebook</span>
      </footer>
      <Modal
        open={createOpen}
        title="A new notebook"
        onClose={() => setCreateOpen(false)}
      >
        <p className="helper">
          A place for your references, experiments, and unfinished ideas.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(async () => {
              if (!canLeave()) return;
              const name = String(data.get("name")).trim();
              if (!name) throw Error("Give your project a name.");
              const w = await repo.createWorkflow(
                {
                  name,
                  description: String(data.get("description")),
                  objective: String(data.get("objective")),
                  platform: String(data.get("platform")),
                },
                data.get("template") === "ad",
              );
              await activate(w.id, true);
              setCreateOpen(false);
            });
          }}
        >
          <label>
            Project title
            <input
              name="name"
              required
              autoFocus
              placeholder="An idea worth exploring"
            />
          </label>
          <label>
            Creative objective
            <textarea
              name="objective"
              placeholder="What are you trying to make?"
            />
          </label>
          <label>
            A little context
            <textarea
              name="description"
              placeholder="A story, a feeling, an intention…"
            />
          </label>
          <label>
            Creative platform
            <input name="platform" placeholder="Any tool you like" />
          </label>
          <label>
            Starting point
            <select name="template">
              <option value="ad">Product advertisement · four chapters</option>
              <option value="empty">A blank notebook · one chapter</option>
            </select>
          </label>
          <button className="primary full" disabled={busy} type="submit">
            Create project
            <ArrowRight size={16} />
          </button>
        </form>
      </Modal>
      <Modal
        open={failureOpen}
        title="What didn't work?"
        onClose={() => setFailureOpen(false)}
      >
        <p className="helper">
          A revision is part of the process. What would you like to revisit?
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!editor) return;
              if (!categories.length)
                throw Error("Choose at least one detail to revisit.");
              await save();
              await repo.reject(editor.id, {
                categories,
                explanation,
                createdAt: Date.now(),
              });
              setFailureOpen(false);
              setNotice(
                "Revision noted. The image stays in your contact sheet.",
              );
            });
          }}
        >
          {failureCategories.map((c) => (
            <label className="revision-choice" key={c}>
              <input
                type="checkbox"
                checked={categories.includes(c)}
                onChange={(e) =>
                  setCategories(
                    e.target.checked
                      ? [...categories, c]
                      : categories.filter((x) => x !== c),
                  )
                }
              />
              <span>{revisionLabel[c] ?? c}</span>
            </label>
          ))}
          <label>
            What would you change on the next attempt?
            <textarea
              aria-label="Revision note"
              rows={4}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="The logo should match the approved product…"
            />
          </label>
          <p className="helper">
            Last approved reference:{" "}
            {source
              ? checkpointLabel(source)
              : "No approved reference attached"}
          </p>
          <button
            className="primary full"
            disabled={busy || !categories.length}
          >
            Save revision note
          </button>
        </form>
      </Modal>
      <Modal
        open={!!reviewId}
        title="Compare with Reference"
        wide
        onClose={() => {
          if (
            !hasUnsavedAnnotation() ||
            window.confirm("Discard unsaved annotation changes?")
          )
            setReviewId(undefined);
        }}
      >
        {reviewId && (
          <ReferenceReview
            key={reviewId}
            attemptId={reviewId}
            onRetry={(id) =>
              void run(async () => {
                const a = await db.attempts.get(id);
                if (a) {
                  setReviewId(undefined);
                  await setSelection(a);
                  document
                    .getElementById("revision-direction")
                    ?.scrollIntoView();
                }
              })
            }
            onOpenSource={(id) =>
              void run(async () => {
                if (
                  hasUnsavedAnnotation() &&
                  !window.confirm("Discard unsaved annotation changes?")
                )
                  return;
                const a = await db.attempts.get(id);
                if (a) {
                  setReviewId(undefined);
                  await setSelection(a);
                }
              })
            }
          />
        )}
      </Modal>
      <Modal
        open={compareOpen}
        title="Side by side"
        onClose={() => setCompareOpen(false)}
        wide
      >
        <Comparison
          attempts={stageAttempts.map((a) =>
            a.id === editor?.id ? editor : a,
          )}
          ids={compareIds}
          onIds={setCompareIds}
          busy={busy}
          onDecision={(a, action) =>
            void run(async () => {
              await save();
              if (action === "keep") {
                await repo.approve(a.id);
                setNotice("Kept. Earlier decisions remain in history.");
              }
              if (action === "reject") {
                await setSelection(a);
                setCompareOpen(false);
                beginRevision();
              }
              if (action === "revise") {
                await setSelection(await repo.branch(a.id));
                setCompareOpen(false);
              }
            })
          }
        />
      </Modal>
    </div>
  );
}
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <h2>Could not open the workspace</h2>
        <p>
          Local storage may be unavailable. Reload to try again; saved data has
          not been cleared.
        </p>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);
