import type {
  CanvasNode,
  Handoff,
  PlatformAdapter,
  RemoteCanvas,
} from "./types";
export const FLORA_BASE = "https://app.flora.ai/api/v1";
export const floraCapabilities = {
  browse: true,
  importImages: true,
  liveSelection: false,
  prepareNode: true,
  automaticGeneration: false,
};
export class BridgeError extends Error {
  constructor(
    public state:
      | "Authentication required"
      | "Permission denied"
      | "Unsupported feature"
      | "Connection error",
    message: string,
  ) {
    super(message);
  }
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const str = (v: unknown) => (typeof v === "string" ? v : undefined);
export function list(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v))
    throw new BridgeError(
      "Unsupported feature",
      "FLORA returned an unsupported response shape.",
    );
  return v.map(record);
}
export function publicId(id: string, prefix: string) {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`).test(id))
    throw Error("Invalid FLORA identifier.");
  return encodeURIComponent(id);
}
// The canonical definition preserves opaque input/output fields. Typed graph fields
// are joined ONLY by exact node UUID, never by position, order or label.
export function parseCanvas(
  value: unknown,
  graphValue?: unknown,
): RemoteCanvas {
  const root = record(value),
    def = record(root.definition),
    graph = record(graphValue);
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.map(record) : [];
  const nodes: CanvasNode[] = list(def.nodes).map((n) => {
    if (!str(n.id) || !str(n.type))
      throw Error("Canvas node identity unavailable.");
    const g = graphNodes.find((g) => g.node_id === n.id) ?? {};
    const position = record(n.position);
    return {
      id: n.id as string,
      shortId: str(g.id),
      type: str(g.type) ?? (n.type as string),
      label: str(g.label) ?? (n.type as string),
      prompt: str(g.prompt),
      model: str(g.model_id) ?? str(g.model),
      outputUrl: str(g.output_url),
      text: str(g.output_text) ?? str(g.text),
      position:
        typeof position.x === "number" && typeof position.y === "number"
          ? { x: position.x, y: position.y }
          : undefined,
      inputs: record(record(def.node_inputs)[n.id as string]),
      output: record(record(def.node_outputs)[n.id as string]),
    };
  });
  return {
    projectId: str(root.project_id) ?? "",
    url: str(root.canvas_url),
    nodes,
    edges: list(def.edges).map((e) => {
      if (!str(e.id) || !str(e.source) || !str(e.target))
        throw Error("Canvas edge identity unavailable.");
      return {
        id: e.id as string,
        source: e.source as string,
        target: e.target as string,
        sourceHandle: str(e.source_handle),
        targetHandle: str(e.target_handle),
      };
    }),
  };
}
export function handoffBody(h: Handoff) {
  if (h.mode !== "node" || !h.referenceNodeId || !h.prompt.trim())
    throw Error("Use the manual handoff for this reference.");
  if (h.prompt.length > 20000)
    throw Error("Shorten the handoff prompt to 20,000 characters.");
  return {
    add: [
      {
        ref: "preserve_next",
        type: "image",
        label: "PRESERVE · Next iteration",
        prompt: h.prompt,
      },
    ],
    connect: [{ from: h.referenceNodeId, to: "preserve_next", in: "image" }],
  };
}
export type Transport = (
  op: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
export const runtimeTransport: Transport = async (op, args = {}) => {
  if (!globalThis.chrome?.runtime?.sendMessage)
    throw new BridgeError(
      "Unsupported feature",
      "Load the built Chrome extension to connect FLORA.",
    );
  const r = await chrome.runtime.sendMessage({ bridge: "flora", op, args });
  if (!r?.ok)
    throw new BridgeError(
      r?.state ?? "Connection error",
      r?.error ?? "The FLORA bridge is unavailable.",
    );
  return r.value;
};
export class FloraAdapter implements PlatformAdapter {
  id = "FLORA";
  capabilities = floraCapabilities;
  constructor(private send: Transport = runtimeTransport) {}
  async status() {
    return (await this.send("status"))
      ? ("Connected" as const)
      : ("Not connected" as const);
  }
  async connect(key: string) {
    return list(record(await this.send("connect", { key })).workspaces).map(
      (w) => ({ id: String(w.workspace_id), name: String(w.name) }),
    );
  }
  async disconnect() {
    await this.send("disconnect");
  }
  async workspaces() {
    return list(record(await this.send("workspaces")).workspaces).map((w) => ({
      id: String(w.workspace_id),
      name: String(w.name),
    }));
  }
  async projects(workspaceId: string, cursor?: string, shared = false) {
    const r = record(
      await this.send("projects", { workspaceId, cursor, shared }),
    );
    return {
      projects: list(r.projects).map((p) => ({
        id: String(p.project_id),
        name: String(p.name),
      })),
      cursor: str(record(r.meta).next_cursor),
    };
  }
  async canvas(workspaceId: string, projectId: string) {
    const args = { workspaceId, projectId };
    const definition = await this.send("definition", args);
    let graph: unknown;
    try {
      graph = await this.send("graph", args);
    } catch (e) {
      if (!(e instanceof BridgeError) || e.state !== "Unsupported feature")
        throw e;
    }
    const canvas = parseCanvas(definition, graph);
    if (canvas.projectId !== projectId)
      throw Error("FLORA returned a different project.");
    // The documented nodes endpoint supplies asset IDs, unlike the graph endpoint.
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const r = record(await this.send("nodes", { projectId, cursor }));
      for (const item of list(r.nodes)) {
        const n = canvas.nodes.find((n) => n.id === item.node_id);
        if (n) {
          n.assetId = str(item.asset_id);
          n.outputUrl ??= item.type !== "text" ? str(item.url) : undefined;
          n.text ??= item.type === "text" ? str(item.url) : undefined;
        }
      }
      cursor = str(record(r.meta).next_cursor);
      if (cursor && seen.has(cursor))
        throw Error("FLORA pagination repeated. Refresh the canvas.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return canvas;
  }
  async asset(assetId: string) {
    const r = record(await this.send("asset", { assetId }));
    if (r.status !== "ready")
      throw Error("This asset is not ready or is unavailable.");
    return { url: str(r.url), type: str(r.content_type) };
  }
  async prepare(handoff: Handoff, confirmed: boolean) {
    if (!confirmed)
      throw Error("Confirm the preview before creating a FLORA node.");
    handoffBody(handoff);
    const result = record(
      await this.send("prepare", { handoff, confirmed: true }),
    );
    if (
      !str(record(record(result.created).preserve_next).node_id) ||
      record(result.applied).added !== 1 ||
      record(result.applied).connected !== 1
    )
      throw new BridgeError(
        "Connection error",
        "FLORA did not confirm both the new node and reference edge. Inspect the canvas before preparing another action.",
      );
    return result;
  }
}
export const flora = new FloraAdapter();
// Download URLs never receive the API bearer credential or browser cookies.
export function assetOrigin(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !(
      u.hostname === "app.flora.ai" ||
      u.hostname === "ik.imagekit.io" ||
      u.hostname === "storage.googleapis.com" ||
      u.hostname.endsWith(".s3.amazonaws.com")
    )
  )
    throw Error(
      "Unsupported asset host. Download this asset manually in FLORA, then upload it to PRESERVE.",
    );
  return `${u.origin}/*`;
}
export async function downloadImage(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  assetOrigin(url);
  const r = await fetcher(url, {
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw Error("Asset download failed. Reload the canvas to refresh its URL.");
  const type = r.headers.get("content-type")?.split(";")[0] ?? "";
  if (!["image/png", "image/jpeg", "image/webp"].includes(type))
    throw Error("Only PNG, JPEG and WebP image imports are supported.");
  const max = 15 * 1024 * 1024;
  if (Number(r.headers.get("content-length")) > max)
    throw Error("Image exceeds 15 MB.");
  const reader = r.body?.getReader();
  if (!reader) throw Error("Empty asset response.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Error("Image exceeds 15 MB.");
    }
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
  if (!size) throw Error("Empty asset response.");
  return new Blob(chunks, { type });
}
