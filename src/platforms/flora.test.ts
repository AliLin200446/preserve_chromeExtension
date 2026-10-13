import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import {
  FloraAdapter,
  BridgeError,
  parseCanvas,
  downloadImage,
  assetOrigin,
  handoffBody,
} from "./flora";
import { createFloraService } from "./service";
import { importNode, prepareHandoff } from "./import";
import { PreserveDB, Repository } from "../domain";
import type { Handoff } from "./types";
const definition = {
  project_id: "prj_test",
  canvas_url: "https://app.flora.ai/project/test",
  definition: {
    nodes: [
      {
        id: "uuid-source",
        type: "staticImageBlock",
        data: {},
        position: { x: 20, y: 30 },
      },
      {
        id: "uuid-output",
        type: "resultImageBlock",
        data: {},
        position: { x: 400, y: 30 },
      },
    ],
    edges: [
      {
        id: "edge-one",
        source: "uuid-source",
        target: "uuid-output",
        source_handle: null,
        target_handle: null,
      },
    ],
    node_inputs: { "uuid-output": { prompt: "Exact source input" } },
    node_outputs: { "uuid-output": { opaque: "Stored unmodified" } },
  },
};
const graph = {
  nodes: [
    {
      id: "n2",
      node_id: "uuid-output",
      type: "image",
      label: "Test output",
      prompt: "A bottle",
      model_id: "model-test",
      output_url: "https://ik.imagekit.io/flora/test.png",
    },
  ],
};
const canvas = () => parseCanvas(definition, graph);
const handoff: Handoff = {
  workspaceId: "ws_test",
  projectId: "prj_test",
  projectName: "Test",
  mode: "node",
  referenceNodeId: "uuid-source",
  referenceLabel: "Approved",
  prompt: "Keep the logo",
  idempotencyKey: "test-handoff-123456789",
};
function fixture(status = 200) {
  let key: string | undefined;
  const vault = {
    get: async () => key,
    set: async (k: string) => {
      key = k;
    },
    clear: async () => {
      key = undefined;
    },
  };
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          workspaces: [{ workspace_id: "ws_test", name: "Mock workspace" }],
        }),
        { status },
      ),
  );
  return {
    vault,
    fetcher,
    service: createFloraService(vault, fetcher as typeof fetch),
  };
}
it("connects with a session credential, disconnects and refuses unauthenticated reads", async () => {
  const { service, vault, fetcher } = fixture();
  expect(await service("status")).toBe(false);
  await expect(service("workspaces")).rejects.toMatchObject({
    state: "Authentication required",
  });
  await service("connect", { key: "ak_test_not_a_real_key" });
  expect(await service("status")).toBe(true);
  expect(await vault.get()).toBe("ak_test_not_a_real_key");
  expect(fetcher).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  await service("disconnect");
  expect(await vault.get()).toBeUndefined();
});
it.each([
  [401, "Authentication required"],
  [403, "Permission denied"],
  [404, "Unsupported feature"],
  [429, "Connection error"],
])(
  "handles HTTP %s without reflecting response secrets",
  async (status, state) => {
    const { service, vault } = fixture(status as number);
    await expect(
      service("connect", { key: "ak_secret_fixture" }),
    ).rejects.toMatchObject({ state });
    expect(await vault.get()).toBeUndefined();
  },
);
it("uses only documented workspace/project operations and encoded pagination", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const service = createFloraService(
    {
      get: async () => "ak_fixture",
      set: async () => {},
      clear: async () => {},
    },
    (async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({});
    }) as typeof fetch,
  );
  await service("projects", {
    workspaceId: "ws_test",
    cursor: "opaque&cursor",
    shared: true,
  });
  expect(calls[0].url).toContain("workspace_id=ws_test");
  expect(calls[0].url).toContain("cursor=opaque%26cursor");
  expect(calls[0].url).toContain("visibility=workspace");
  await expect(service("generate")).rejects.toMatchObject({
    state: "Unsupported feature",
  });
});
it("parses canonical nodes and edges, joining metadata by UUID only", () => {
  const c = canvas();
  expect(c.nodes[0].prompt).toBeUndefined();
  expect(c.nodes[1].prompt).toBe("A bottle");
  expect(c.nodes[1].inputs).toEqual({ prompt: "Exact source input" });
  expect(c.edges[0].source).toBe("uuid-source");
  expect(parseCanvas(definition).nodes[1].model).toBeUndefined();
  expect(() => parseCanvas({})).toThrow();
});
it("loads real response pages and selects asset metadata only by node ID", async () => {
  const send = vi.fn(async (op: string) =>
    op === "definition"
      ? definition
      : op === "graph"
        ? graph
        : op === "nodes"
          ? {
              nodes: [
                {
                  node_id: "uuid-output",
                  type: "image",
                  asset_id: "asset_test",
                },
              ],
              meta: { next_cursor: null },
            }
          : {},
  );
  const adapter = new FloraAdapter(send);
  expect((await adapter.canvas("ws_test", "prj_test")).nodes[1].assetId).toBe(
    "asset_test",
  );
  expect(adapter.capabilities.liveSelection).toBe(false);
});
it("downloads bounded supported assets without credentials and rejects unsafe or missing assets", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(new Uint8Array([1, 2]), {
        headers: { "content-type": "image/png" },
      }),
  );
  expect(
    (
      await downloadImage(
        "https://ik.imagekit.io/flora/a.png",
        fetcher as typeof fetch,
      )
    ).size,
  ).toBe(2);
  expect(fetcher.mock.calls[0]).toBeDefined();
  expect(() => assetOrigin("https://evil.example/a")).toThrow();
  expect(() => assetOrigin("http://ik.imagekit.io/a")).toThrow();
  await expect(
    downloadImage(
      "https://ik.imagekit.io/a",
      async () => new Response("", { status: 404 }),
    ),
  ).rejects.toThrow();
  await expect(
    downloadImage(
      "https://ik.imagekit.io/a",
      async () =>
        new Response("video", { headers: { "content-type": "video/mp4" } }),
    ),
  ).rejects.toThrow();
});
it("creates only an explicitly confirmed new unrun image node", async () => {
  const { service, vault, fetcher } = fixture();
  await vault.set("ak_fixture");
  await expect(service("prepare", { handoff })).rejects.toThrow("confirmation");
  expect(fetcher).not.toHaveBeenCalled();
  await service("prepare", { handoff, confirmed: true });
  expect(fetcher).toHaveBeenCalledOnce();
  const body = handoffBody(handoff);
  expect(body).toEqual({
    add: [
      {
        ref: "preserve_next",
        type: "image",
        label: "PRESERVE · Next iteration",
        prompt: "Keep the logo",
      },
    ],
    connect: [{ from: "uuid-source", to: "preserve_next", in: "image" }],
  });
  expect(JSON.stringify(body)).not.toContain("run");
  const a = new FloraAdapter(async () => ({}));
  await expect(a.prepare(handoff, false)).rejects.toThrow();
});
it("imports image/provenance atomically, preserves lineage, rejects duplicates and historical destinations", async () => {
  const db = new PreserveDB("flora-test-" + crypto.randomUUID());
  try {
    const repo = new Repository(db);
    const w = await repo.createWorkflow({
      name: "Local",
      description: "",
      platform: "",
      objective: "",
    });
    const stages = await db.stages.where({ workflowId: w.id }).sortBy("order");
    const input = {
      workspaceId: "ws_test",
      projectName: "Mock",
      canvas: canvas(),
      node: canvas().nodes[1],
      blob: new Blob(["image"], { type: "image/png" }),
      stageId: stages[0].id,
      approve: false,
    };
    const draft = await importNode(db, input);
    expect(draft.status).toBe("DRAFT");
    expect(draft.sourceCheckpointId).toBeUndefined();
    expect(draft.externalSource?.sourceNodeIds).toEqual(["uuid-source"]);
    expect(draft.externalSource?.nodeId).not.toBe(draft.id);
    await expect(importNode(db, input)).rejects.toThrow("already imported");
    const cp = await repo.approve(draft.id);
    expect(cp.externalSource).toEqual(draft.externalSource);
    const retry = await repo.addAttempt(stages[1].id, cp.id);
    expect(retry.sourceCheckpointId).toBe(cp.id);
    const h = prepareHandoff(
      retry,
      { workspaceId: "ws_test", projectId: "prj_test", projectName: "Test" },
      cp.externalSource,
      "Reference",
    );
    expect(h.mode).toBe("node");
    expect(
      prepareHandoff(
        retry,
        { workspaceId: "ws_test", projectId: "prj_else", projectName: "Other" },
        cp.externalSource,
        "Reference",
      ).mode,
    ).toBe("manual");
    await expect(
      importNode(db, {
        ...input,
        node: { ...input.node, id: "uuid-source" },
        draftId: draft.id,
        blob: new Blob(["changed"], { type: "image/png" }),
      }),
    ).rejects.toThrow("Destination draft changed");
    await expect(
      importNode(db, { ...input, node: { ...input.node, type: "video" } }),
    ).rejects.toThrow("node type");
    expect(await db.checkpoints.get(cp.id)).toEqual(cp);
    expect(db.verno).toBe(2);
  } finally {
    await db.delete();
  }
});
it("does not convert unknown error responses into successful connections", async () => {
  const a = new FloraAdapter(async () => {
    throw new BridgeError("Permission denied", "No access");
  });
  await expect(a.connect("ak_fixture")).rejects.toMatchObject({
    state: "Permission denied",
  });
});

it("requires documented write acknowledgement before reporting success", async () => {
  const rejected = new FloraAdapter(async () => ({
    created: {},
    applied: { added: 0, connected: 0 },
  }));
  await expect(rejected.prepare(handoff, true)).rejects.toThrow(
    "did not confirm",
  );
  const accepted = new FloraAdapter(async () => ({
    created: { preserve_next: { id: "n9", node_id: "uuid-new" } },
    applied: { added: 1, connected: 1 },
  }));
  await expect(accepted.prepare(handoff, true)).resolves.toMatchObject({
    applied: { added: 1 },
  });
});
