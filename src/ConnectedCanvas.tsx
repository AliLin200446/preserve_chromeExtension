import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, validateImage, type Attempt } from "./domain";
import { Preview } from "./NotebookPieces";
import {
  flora,
  assetOrigin,
  BridgeError,
  downloadImage,
} from "./platforms/flora";
import {
  blobHash,
  imageNode,
  importNode,
  prepareHandoff,
} from "./platforms/import";
import type {
  ConnectionState,
  Handoff,
  RemoteCanvas,
  RemoteProject,
} from "./platforms/types";
import "./bridge.css";
export function ConnectedCanvas({
  stageId,
  workflowId,
  attempt,
  dirty,
  onImported,
}: {
  stageId: string;
  workflowId: string;
  attempt?: Attempt;
  dirty: boolean;
  onImported: (a: Attempt) => Promise<void>;
}) {
  const [state, setState] = useState<ConnectionState>("Not connected");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [workspaces, setWorkspaces] = useState<RemoteProject[]>([]),
    [projects, setProjects] = useState<RemoteProject[]>([]);
  const [workspace, setWorkspace] = useState(""),
    [project, setProject] = useState(""),
    [cursor, setCursor] = useState<string>();
  const [shared, setShared] = useState(false),
    [canvas, setCanvas] = useState<RemoteCanvas>(),
    [nodeId, setNodeId] = useState(""),
    [search, setSearch] = useState("");
  const [resolvedAssetUrl, setResolvedAssetUrl] = useState<string>();
  useEffect(() => {
    setResolvedAssetUrl(undefined);
  }, [nodeId, canvas]);
  const [asset, setAsset] = useState<Blob>(),
    [destination, setDestination] = useState(workflowId),
    [chapter, setChapter] = useState(stageId),
    [draft, setDraft] = useState(""),
    [reference, setReference] = useState("");
  const [draftRevision, setDraftRevision] = useState<number>();
  const [referenceImage, setReferenceImage] = useState<Blob>();
  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => {
    setPreview(undefined);
    setConfirm(false);
  }, [attempt?.id, attempt?.updatedAt]);
  const [approve, setApprove] = useState(false),
    [preview, setPreview] = useState<Handoff>(),
    [confirm, setConfirm] = useState(false),
    [onFlora, setOnFlora] = useState(false);
  const localProjects = useLiveQuery(() => db.workflows.toArray()) ?? [];
  const stages =
    useLiveQuery(
      () => db.stages.where({ workflowId: destination }).sortBy("order"),
      [destination],
    ) ?? [];
  const drafts =
    useLiveQuery(
      () => db.attempts.where({ stageId: chapter }).toArray(),
      [chapter],
    ) ?? [];
  const checkpoints =
    useLiveQuery(
      () => db.checkpoints.where({ workflowId: destination }).toArray(),
      [destination],
    ) ?? [];
  const node = canvas?.nodes.find((n) => n.id === nodeId);
  const clearRemote = () => {
    setWorkspaces([]);
    setProjects([]);
    setWorkspace("");
    setProject("");
    setCanvas(undefined);
    setAsset(undefined);
    setNodeId("");
    setPreview(undefined);
    setConfirm(false);
    setKey("");
  };
  useEffect(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    void flora
      .status()
      .then(setState)
      .catch(() => {});
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && changes.floraCredential) {
        if (!changes.floraCredential.newValue) {
          clearRemote();
          setState("Not connected");
        } else setState("Connected");
      }
    };
    const active = () =>
      void chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then((tabs) =>
          setOnFlora(
            tabs.some((t) => t.url?.startsWith("https://app.flora.ai/")),
          ),
        )
        .catch(() => {});
    active();
    chrome.storage.onChanged.addListener(changed);
    chrome.tabs.onActivated.addListener(active);
    chrome.tabs.onUpdated.addListener(active);
    return () => {
      chrome.storage.onChanged.removeListener(changed);
      chrome.tabs.onActivated.removeListener(active);
      chrome.tabs.onUpdated.removeListener(active);
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The operation failed.");
      if (e instanceof BridgeError) setState(e.state);
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    if (!globalThis.chrome?.permissions)
      throw new BridgeError(
        "Unsupported feature",
        "Load the built Chrome extension to use the bridge.",
      );
    // Request only this origin, directly from the Connect click gesture.
    if (
      !(await chrome.permissions.request({
        origins: ["https://app.flora.ai/*"],
      }))
    )
      throw new BridgeError(
        "Permission denied",
        "FLORA host access was not granted. Local workflows remain available.",
      );
    setState("Connecting");
    const credential = key;
    setKey("");
    const w = await flora.connect(credential);
    setWorkspaces(w);
    setState("Connected");
  };
  const loadProjects = async (w: string, more = false) => {
    setPreview(undefined);
    const result = await flora.projects(w, more ? cursor : undefined, shared);
    setProjects((old) =>
      more
        ? [
            ...old,
            ...result.projects.filter((p) => !old.some((o) => o.id === p.id)),
          ]
        : result.projects,
    );
    setCursor(result.cursor);
    setState("Connected");
  };
  const loadAsset = async () => {
    if (!node) return;
    let url = node.outputUrl;
    if (node.assetId) url = (await flora.asset(node.assetId)).url;
    if (!url) throw Error("This node has no accessible output asset.");
    const origin = assetOrigin(url);
    if (!(await chrome.permissions.contains({ origins: [origin] }))) {
      setResolvedAssetUrl(url);
      setMessage(
        "Asset URL resolved. Click Load selected image again to allow its download host.",
      );
      return;
    }
    const blob = await downloadImage(url);
    await validateImage(new File([blob], "flora-output", { type: blob.type }));
    setAsset(blob);
    setMessage("Output loaded. Choose where to save it.");
  };
  const allowAsset = async () => {
    // Asset ID resolution might reveal a different CDN; show it before requesting.
    const url = resolvedAssetUrl ?? node?.outputUrl;
    if (!url) {
      if (node?.assetId) {
        const asset = await flora.asset(node.assetId);
        if (asset.url) {
          assetOrigin(asset.url);
          setResolvedAssetUrl(asset.url);
          setMessage(
            "Asset URL resolved. Click Load selected image again to allow its download host.",
          );
          return;
        }
      }
      throw Error(
        "The API did not expose an accessible download URL. Import this output manually.",
      );
    }
    if (
      !(await chrome.permissions.request({
        origins: [assetOrigin(url)],
      }))
    )
      throw new BridgeError(
        "Permission denied",
        "Asset host access was not granted.",
      );
    await loadAsset();
  };
  const prepare = async () => {
    if (!attempt || !project || !workspace)
      throw Error("Select a FLORA target project and a saved iteration.");
    const checkpoint =
      attempt.status === "APPROVED"
        ? await db.checkpoints.where({ attemptId: attempt.id }).first()
        : attempt.sourceCheckpointId
          ? await db.checkpoints.get(attempt.sourceCheckpointId)
          : undefined;
    if (!checkpoint)
      throw Error(
        "Choose an iteration with an approved reference before preparing a handoff.",
      );
    const h = prepareHandoff(
      attempt,
      {
        workspaceId: workspace,
        projectId: project,
        projectName: projects.find((p) => p.id === project)?.name ?? project,
      },
      checkpoint.externalSource,
      "Approved reference",
    );
    if (h.mode === "node") {
      const current = await flora.canvas(workspace, project);
      const source = current.nodes.find((n) => n.id === h.referenceNodeId);
      if (!source?.outputUrl || !imageNode(source)) {
        h.mode = "manual";
      } else {
        const origin = assetOrigin(source.outputUrl);
        if (!(await chrome.permissions.contains({ origins: [origin] })))
          h.mode = "manual";
        else if (
          (await blobHash(await downloadImage(source.outputUrl))) !==
          (await blobHash(checkpoint.image))
        )
          h.mode = "manual";
      }
    }
    setReferenceImage(checkpoint.image);
    setPreview(h);
    setConfirm(false);
  };
  const write = async () => {
    if (!preview || !confirm)
      throw Error("Review and confirm the prepared action.");
    // Recheck the reference at commit time; remote nodes may change after preview.
    const cp =
      attempt?.status === "APPROVED"
        ? await db.checkpoints.where({ attemptId: attempt.id }).first()
        : attempt?.sourceCheckpointId
          ? await db.checkpoints.get(attempt.sourceCheckpointId)
          : undefined;
    const current = await flora.canvas(preview.workspaceId, preview.projectId);
    const source = current.nodes.find((n) => n.id === preview.referenceNodeId);
    if (
      !cp ||
      !source?.outputUrl ||
      (await blobHash(await downloadImage(source.outputUrl))) !==
        (await blobHash(cp.image))
    )
      throw Error(
        "The remote reference changed. Prepare a new preview or use manual handoff.",
      );
    await flora.prepare(preview, true);
    setPreview(undefined);
    setConfirm(false);
    setMessage("New FLORA image node prepared. No generation was started.");
  };
  return (
    <details className="connected-canvas">
      <summary>
        Connected Canvas{" "}
        <span>
          {onFlora ? "FLORA · " : ""}
          {state}
        </span>
      </summary>
      <div className="bridge-content">
        <h3>
          FLORA <span>Canvas connection</span>
        </h3>
        <p role="status">
          {state}
          {busy ? " · Working…" : ""}
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <fieldset disabled={busy}>
          <details className="disclosure">
            <summary>Connection & privacy</summary>
            <p className="helper">
              Use a workspace-scoped FLORA API key with read access. Preparing
              nodes also requires write access. Billing permission is not
              needed. The key stays in extension session storage until
              disconnect or browser restart; it is never stored with creative
              work. Imported images remain local after disconnect.
            </p>
            <a
              href="https://app.flora.ai/projects?openSettings=true&initialTab=apiKeys"
              target="_blank"
              rel="noreferrer"
            >
              Create a FLORA API key ↗
            </a>
            <label>
              FLORA API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="ak_…"
              />
            </label>
            <button disabled={!key.trim()} onClick={() => void run(connect)}>
              Connect FLORA
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await flora.disconnect();
                  clearRemote();
                  setState("Not connected");
                  await chrome.permissions.remove({
                    origins: [
                      "https://app.flora.ai/*",
                      "https://ik.imagekit.io/*",
                      "https://storage.googleapis.com/*",
                      "https://*.s3.amazonaws.com/*",
                    ],
                  });
                })
              }
            >
              Disconnect FLORA
            </button>
          </details>
          {state === "Not connected" && (
            <p className="helper">
              Open Connection & privacy to connect your account.
            </p>
          )}
          <button
            onClick={() =>
              void run(async () => {
                setWorkspaces(await flora.workspaces());
                setState("Connected");
              })
            }
          >
            Load workspaces
          </button>
          {workspaces.length > 0 && (
            <>
              <label>
                FLORA workspace
                <select
                  aria-label="FLORA workspace"
                  value={workspace}
                  onChange={(e) => {
                    const w = e.target.value;
                    setWorkspace(w);
                    setProjects([]);
                    setProject("");
                    setCanvas(undefined);
                    setAsset(undefined);
                    setPreview(undefined);
                    if (w) void run(() => loadProjects(w));
                  }}
                >
                  <option value="">Choose workspace</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project visibility
                <select
                  aria-label="Project visibility"
                  value={shared ? "workspace" : "mine"}
                  onChange={(e) => {
                    setShared(e.target.value === "workspace");
                    setProjects([]);
                    setProject("");
                    setCanvas(undefined);
                    setPreview(undefined);
                  }}
                >
                  <option value="mine">My projects</option>
                  <option value="workspace">Workspace-shared projects</option>
                </select>
              </label>
              <button
                disabled={!workspace}
                onClick={() => void run(() => loadProjects(workspace))}
              >
                Refresh projects
              </button>
              <label>
                FLORA project
                <select
                  aria-label="FLORA project"
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                    setCanvas(undefined);
                    setAsset(undefined);
                    setNodeId("");
                    setPreview(undefined);
                  }}
                >
                  <option value="">Choose project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {cursor && (
                <button
                  onClick={() => void run(() => loadProjects(workspace, true))}
                >
                  More projects
                </button>
              )}
              <button
                disabled={!project}
                onClick={() =>
                  void run(async () => {
                    setCanvas(undefined);
                    setAsset(undefined);
                    setNodeId("");
                    setCanvas(await flora.canvas(workspace, project));
                    setState("Connected");
                  })
                }
              >
                Load canvas
              </button>
            </>
          )}
          {canvas && (
            <>
              <h4>
                Source canvas · FLORA /{" "}
                {projects.find((p) => p.id === project)?.name}
              </h4>
              <p className="helper">
                {canvas.nodes.length} nodes · {canvas.edges.length} canvas
                edges. Choose here; browser selection is not synchronized.
              </p>
              <label>
                Search canvas nodes
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label>
                Choose Node from Canvas
                <select
                  aria-label="Choose Node from Canvas"
                  value={nodeId}
                  onChange={(e) => {
                    setNodeId(e.target.value);
                    setShowVideo(false);
                    setAsset(undefined);
                    setMessage("");
                  }}
                >
                  <option value="">Choose node</option>
                  {canvas.nodes
                    .filter((n) =>
                      `${n.label} ${n.type} ${n.id}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} · {n.type} · {n.id}
                      </option>
                    ))}
                </select>
              </label>
              {node && (
                <>
                  <p>
                    {node.type} · {node.model ?? "Model not exposed"}
                  </p>
                  {node.text && <blockquote>{node.text}</blockquote>}
                  {imageNode(node) ? (
                    <>
                      <button onClick={() => void run(allowAsset)}>
                        Load selected image
                      </button>
                      {(resolvedAssetUrl ?? node.outputUrl) && (
                        <p className="helper">
                          Download host:{" "}
                          {(() => {
                            try {
                              return new URL(
                                resolvedAssetUrl ?? node.outputUrl!,
                              ).hostname;
                            } catch {
                              return "Unavailable";
                            }
                          })()}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="helper">
                      Preview/import for this node type is not supported. Text
                      remains readable here; video and audio remain in FLORA.
                    </p>
                  )}
                  {node.type === "video" && node.outputUrl && (
                    <>
                      <button
                        onClick={() => {
                          try {
                            assetOrigin(node.outputUrl!);
                            setShowVideo(true);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Preview video output
                      </button>
                      {showVideo && (
                        <video
                          crossOrigin="anonymous"
                          controls
                          preload="metadata"
                          src={node.outputUrl}
                          style={{ width: "100%" }}
                        />
                      )}
                    </>
                  )}
                  {asset && (
                    <Preview blob={asset} label="Selected FLORA output" />
                  )}
                  <details className="disclosure">
                    <summary>Source node & relationships</summary>
                    <p className="technical-id">
                      Workspace {workspace}
                      <br />
                      Project {canvas.projectId}
                      <br />
                      Node {node.id}
                      <br />
                      Asset {node.assetId ?? "Not exposed"}
                      <br />
                      Generation ID: not exposed by the typed canvas API
                    </p>
                    <p>
                      Incoming canvas edges:{" "}
                      {canvas.edges
                        .filter((e) => e.target === node.id)
                        .map((e) => e.source)
                        .join(", ") || "None"}
                    </p>
                    <p>{node.prompt ?? "Prompt not exposed"}</p>
                    <pre>
                      {JSON.stringify(
                        {
                          inputs: node.inputs,
                          output: node.output,
                          edges: canvas.edges.filter(
                            (e) => e.source === node.id || e.target === node.id,
                          ),
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <p className="helper">
                      Canvas edges are recorded as provenance. They do not
                      automatically become approved references.
                    </p>
                  </details>
                  <h4>Destination</h4>
                  <label>
                    PRESERVE project
                    <select
                      aria-label="PRESERVE project"
                      value={destination}
                      onChange={(e) => {
                        setDestination(e.target.value);
                        setChapter("");
                        setDraft("");
                        setReference("");
                      }}
                    >
                      {localProjects.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Stage / Chapter
                    <select
                      aria-label="Stage / Chapter"
                      value={chapter}
                      onChange={(e) => {
                        setChapter(e.target.value);
                        setDraft("");
                      }}
                    >
                      <option value="">Choose stage</option>
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Import destination
                    <select
                      aria-label="Import destination"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setDraftRevision(
                          drafts.find((a) => a.id === e.target.value)
                            ?.updatedAt,
                        );
                      }}
                    >
                      <option value="">New iteration</option>
                      {drafts
                        .filter((a) => a.status === "DRAFT" && !a.image)
                        .map((a, i) => (
                          <option key={a.id} value={a.id}>
                            Empty draft {i + 1} · {a.prompt.objective}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!draft && (
                    <label>
                      Approved reference (optional, explicitly chosen)
                      <select
                        aria-label="Approved reference (optional, explicitly chosen)"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      >
                        <option value="">No PRESERVE reference</option>
                        {checkpoints.map((c, i) => (
                          <option key={c.id} value={c.id}>
                            Kept reference {i + 1} · {c.prompt.objective}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Decision
                    <select
                      aria-label="Decision"
                      value={approve ? "approve" : "draft"}
                      onChange={(e) => setApprove(e.target.value === "approve")}
                    >
                      <option value="draft">Save as Draft</option>
                      <option value="approve">Approve as Checkpoint</option>
                    </select>
                  </label>
                  <p className="helper">
                    The selected output and available prompt will be saved
                    locally
                    {draft
                      ? " into the chosen empty draft, replacing its direction notes"
                      : ""}
                    .{" "}
                    {approve
                      ? "This explicitly approves the output as a new checkpoint."
                      : "You can review and approve it later."}
                  </p>
                  <button
                    className="primary"
                    disabled={!asset || !chapter || dirty}
                    onClick={() =>
                      void run(async () => {
                        if (!asset || !canvas || !node) return;
                        const a = await importNode(db, {
                          workspaceId: workspace,
                          projectName:
                            projects.find((p) => p.id === project)?.name ??
                            project,
                          canvas,
                          node,
                          blob: asset,
                          stageId: chapter,
                          draftId: draft || undefined,
                          expectedUpdatedAt: draftRevision,
                          checkpointId: reference || undefined,
                          approve,
                        });
                        await onImported(a);
                        setAsset(undefined);
                        setMessage("Saved to PRESERVE.");
                      })
                    }
                  >
                    {approve ? "Save as Checkpoint" : "Save to PRESERVE"}
                  </button>
                </>
              )}
            </>
          )}
          <button
            disabled={!attempt || !project || dirty}
            onClick={() => void run(prepare)}
          >
            Prepare Retry on Canvas
          </button>
          {dirty && (
            <p className="helper">
              Save Notebook changes before importing or preparing a handoff.
            </p>
          )}
          {preview && (
            <section className="handoff-preview">
              <h4>Prepare Next Generation on FLORA</h4>
              {referenceImage && (
                <Preview
                  blob={referenceImage}
                  label="Approved handoff reference"
                />
              )}
              <p>Target: {preview.projectName}</p>
              <p>
                Reference: {preview.referenceLabel} ·{" "}
                {preview.referenceNodeId ?? "Local approved image"}
              </p>
              <p>
                {preview.mode === "node"
                  ? "Create one new image node with this prompt and connect the verified approved source. No model run is requested; generation later in FLORA may cost credits."
                  : "Manual handoff: this approved image cannot be verified on this target canvas. Copy the prompt and upload the approved reference in FLORA yourself."}
              </p>
              <label>
                Handoff prompt
                <textarea readOnly value={preview.prompt} rows={8} />
              </label>
              <button
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(preview.prompt);
                    setMessage("Handoff prompt copied.");
                  })
                }
              >
                Copy handoff prompt
              </button>
              {preview.mode === "node" && (
                <>
                  <label className="bridge-confirm">
                    <input
                      type="checkbox"
                      checked={confirm}
                      onChange={(e) => setConfirm(e.target.checked)}
                    />
                    I confirm creating this new node in the selected FLORA
                    project.
                  </label>
                  <button
                    className="primary"
                    disabled={!confirm || dirty}
                    onClick={() => void run(write)}
                  >
                    Confirm · Create FLORA node
                  </button>
                </>
              )}
            </section>
          )}
          <details className="disclosure">
            <summary>Platform capabilities</summary>
            <p>
              FLORA: API browsing, image import, confirmed node preparation. No
              live browser selection or automatic generation. Video/audio
              imports and local-reference uploads are not available.
            </p>
            <p>
              Krea / Runway / OpenArt: Not connected · Integration not
              available.
            </p>
          </details>
        </fieldset>
      </div>
    </details>
  );
}
