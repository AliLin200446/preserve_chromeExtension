import {
  BridgeError,
  FLORA_BASE,
  handoffBody,
  publicId,
  record,
} from "./flora";
import type { Handoff } from "./types";
export interface CredentialVault {
  get(): Promise<string | undefined>;
  set(key: string): Promise<void>;
  clear(): Promise<void>;
}
export function createFloraService(
  vault: CredentialVault,
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  let epoch = 0;
  const request = async (
    path: string,
    key: string,
    body?: unknown,
    idempotencyKey?: string,
  ) => {
    let response: Response;
    try {
      response = await fetcher(FLORA_BASE + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey!,
              }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new BridgeError(
        "Connection error",
        "FLORA could not be reached. Check the connection and host permission." +
          (body
            ? " A write may have completed; retry the same preview to avoid duplicates."
            : ""),
      );
    }
    if (!response.ok) {
      const status = response.status;
      throw new BridgeError(
        status === 401
          ? "Authentication required"
          : status === 403
            ? "Permission denied"
            : status === 404 || status === 405 || status === 501
              ? "Unsupported feature"
              : "Connection error",
        status === 401
          ? "The FLORA key is invalid or expired. Reconnect."
          : status === 403
            ? "This key lacks access to the selected workspace or operation."
            : status === 409
              ? "FLORA reported a conflict or duplicate request. Refresh the canvas before preparing another action."
              : status === 429
                ? "FLORA rate limit reached. Try again later."
                : `FLORA request failed (${status}). No success has been assumed.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new BridgeError(
        "Connection error",
        "FLORA returned an unreadable response.",
      );
    }
  };
  return async (op: string, args: Record<string, unknown> = {}) => {
    if (op === "disconnect") {
      epoch++;
      await vault.clear();
      return null;
    }
    if (op === "status") return Boolean(await vault.get());
    if (op === "connect") {
      const current = ++epoch;
      const key = typeof args.key === "string" ? args.key.trim() : "";
      if (!/^ak_\S+$/.test(key))
        throw new BridgeError(
          "Authentication required",
          "Enter a FLORA API key beginning with ak_.",
        );
      await vault.clear();
      const result = await request("/workspaces", key);
      if (current !== epoch) throw Error("Connection cancelled.");
      await vault.set(key);
      return result;
    }
    const token = epoch,
      key = await vault.get();
    if (!key)
      throw new BridgeError(
        "Authentication required",
        "Connect FLORA with an authorized API key.",
      );
    const ws = () => publicId(String(args.workspaceId ?? ""), "ws");
    const prj = () => publicId(String(args.projectId ?? ""), "prj");
    let path: string, body: unknown, idempotencyKey: string | undefined;
    const query = new URLSearchParams({ limit: "100" });
    if (typeof args.cursor === "string") query.set("cursor", args.cursor);
    switch (op) {
      case "workspaces":
        path = "/workspaces";
        break;
      case "projects":
        query.set("workspace_id", decodeURIComponent(ws()));
        if (args.shared) query.set("visibility", "workspace");
        path = "/projects?" + query;
        break;
      case "definition":
        path = `/workspaces/${ws()}/projects/${prj()}/canvas/definition`;
        break;
      case "graph":
        path = `/workspaces/${ws()}/projects/${prj()}/graph`;
        break;
      case "nodes":
        path = `/projects/${prj()}/nodes?${query}`;
        break;
      case "asset":
        path = "/assets/" + publicId(String(args.assetId ?? ""), "asset");
        break;
      case "prepare": {
        if (args.confirmed !== true)
          throw Error("Explicit confirmation required.");
        const h = record(args.handoff) as unknown as Handoff;
        path = `/workspaces/${publicId(h.workspaceId, "ws")}/projects/${publicId(h.projectId, "prj")}/canvas/changeset`;
        if (!/^[\w-]{16,100}$/.test(h.idempotencyKey))
          throw Error("Invalid handoff identity.");
        body = handoffBody(h);
        idempotencyKey = h.idempotencyKey;
        break;
      }
      default:
        throw new BridgeError(
          "Unsupported feature",
          "Unsupported bridge operation.",
        );
    }
    const result = await request(path, key, body, idempotencyKey);
    if (token !== epoch)
      throw Error("Connection changed. Retry after connecting.");
    return result;
  };
}
