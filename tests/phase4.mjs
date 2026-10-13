import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), "preserve-flora-mock-"),
);
const extension = path.resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 360, height: 1000 },
});
let page;
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  // Mock only test network responses; production adapter/service-worker code is unchanged.
  await worker.evaluate(() => {
    globalThis.bridgeCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url);
      globalThis.bridgeCalls.push({
        path: u.pathname + u.search,
        method: init.method,
        body: init.body,
      });
      const auth = init.headers?.Authorization;
      if (auth === "Bearer ak_invalid_fixture")
        return Response.json(
          { error: { message: "Never echo credential" } },
          { status: 401 },
        );
      const image = "https://ik.imagekit.io/flora/preserve-test.png";
      if (u.pathname.endsWith("/workspaces"))
        return Response.json({
          workspaces: [
            { workspace_id: "ws_fixture", name: "Mock test workspace" },
          ],
        });
      if (u.pathname.endsWith("/projects"))
        return Response.json({
          projects: [
            {
              project_id: "prj_fixture",
              name: "Mock canvas",
              workspace_id: "ws_fixture",
            },
          ],
          meta: { next_cursor: null },
        });
      if (u.pathname.endsWith("/canvas/definition"))
        return Response.json({
          project_id: "prj_fixture",
          canvas_url: "https://app.flora.ai/project/fixture",
          definition: {
            nodes: [
              {
                id: "source-uuid",
                type: "staticImageBlock",
                data: {},
                position: { x: 0, y: 0 },
              },
              {
                id: "result-uuid",
                type: "resultImageBlock",
                data: {},
                position: { x: 400, y: 0 },
              },
              {
                id: "text-uuid",
                type: "textBlock",
                data: {},
                position: { x: 0, y: 400 },
              },
            ],
            edges: [
              {
                id: "edge-fixture",
                source: "source-uuid",
                target: "result-uuid",
                source_handle: null,
                target_handle: null,
              },
            ],
            node_inputs: { "result-uuid": { prompt: "Exact API input" } },
            node_outputs: { "result-uuid": { asset_id: "asset_fixture" } },
          },
        });
      if (u.pathname.endsWith("/graph"))
        return Response.json({
          project_id: "prj_fixture",
          nodes: [
            {
              id: "n1",
              node_id: "source-uuid",
              type: "image",
              label: "Source image",
              output_url: image,
            },
            {
              id: "n2",
              node_id: "result-uuid",
              type: "image",
              label: "Bottle output",
              prompt: "A bottle in soft light",
              model_id: "model_fixture",
              output_url: image,
            },
            {
              id: "n3",
              node_id: "text-uuid",
              type: "text",
              label: "Creative direction",
              output_text: "Actual fixture text",
            },
          ],
          edges: [{ from: "n1", to: "n2", in: "image" }],
        });
      if (u.pathname.endsWith("/nodes"))
        return Response.json({
          project_id: "prj_fixture",
          nodes: [
            {
              node_id: "result-uuid",
              type: "image",
              asset_id: "asset_fixture",
              url: image,
            },
          ],
          meta: { next_cursor: null },
        });
      if (u.pathname.endsWith("/assets/asset_fixture"))
        return Response.json({
          asset_id: "asset_fixture",
          status: "ready",
          content_type: "image/png",
          url: image,
        });
      if (u.pathname.endsWith("/canvas/changeset"))
        return Response.json({
          created: { preserve_next: { id: "n4", node_id: "created-fixture" } },
          applied: { added: 1, connected: 1 },
        });
      return Response.json(
        { error: { message: "Unknown mock endpoint" } },
        { status: 404 },
      );
    };
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(12000);
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/index.html`,
  );
  // Chrome native optional permission UI is not automated in this mocked test.
  await page.evaluate(() => {
    chrome.permissions.request = async () => true;
    chrome.permissions.contains = async () => true;
    chrome.permissions.remove = async () => true;
  });
  await page
    .getByRole("button", { name: "Explore a sample notebook", exact: true })
    .click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  const image = await page.screenshot();
  await page.route("https://ik.imagekit.io/flora/preserve-test.png", (r) =>
    r.fulfill({
      status: 200,
      contentType: "image/png",
      body: image,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  const bridge = page.locator(".connected-canvas");
  await bridge.locator(":scope > summary").click();
  await bridge.getByText("Connection & privacy", { exact: true }).click();
  await bridge
    .getByLabel("FLORA API key", { exact: true })
    .fill("ak_invalid_fixture");
  await bridge
    .getByRole("button", { name: "Connect FLORA", exact: true })
    .click();
  await expect(bridge.getByRole("alert")).toContainText("invalid or expired");
  await bridge
    .getByLabel("FLORA API key", { exact: true })
    .fill("ak_mock_not_real");
  await bridge
    .getByRole("button", { name: "Connect FLORA", exact: true })
    .click();
  await expect(bridge.getByLabel("FLORA workspace")).toBeVisible();
  await expect(bridge.getByLabel("FLORA API key", { exact: true })).toHaveValue(
    "",
  );
  await bridge.getByLabel("FLORA workspace").selectOption("ws_fixture");
  await bridge
    .getByLabel("FLORA project", { exact: true })
    .selectOption("prj_fixture");
  await bridge
    .getByRole("button", { name: "Load canvas", exact: true })
    .click();
  await bridge.getByLabel("Choose Node from Canvas").selectOption("text-uuid");
  await expect(
    bridge.getByText("Actual fixture text", { exact: true }),
  ).toBeVisible();
  await bridge.getByLabel("Search canvas nodes").fill("Bottle");
  await bridge
    .getByLabel("Choose Node from Canvas")
    .selectOption("result-uuid");
  await bridge
    .getByRole("button", { name: "Load selected image", exact: true })
    .click();
  await expect(
    bridge.getByRole("img", { name: "Selected FLORA output" }),
  ).toBeVisible();
  await bridge.getByLabel("Decision", { exact: true }).selectOption("approve");
  await bridge
    .getByRole("button", { name: "Save as Checkpoint", exact: true })
    .click();
  await expect(
    page.getByText("Imported from FLORA · Mock canvas", { exact: true }),
  ).toBeVisible();
  const read = () =>
    page.evaluate(async () => {
      const d = await new Promise((r) => {
        const q = indexedDB.open("preserve");
        q.onsuccess = () => r(q.result);
      });
      const read = (store) =>
        new Promise((r) => {
          const q = d.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => r(q.result);
        });
      const attempts = await read("attempts"),
        checkpoints = await read("checkpoints");
      d.close();
      return { attempts, checkpoints };
    });
  const saved = await read();
  const imported = saved.attempts.find((a) => a.externalSource);
  assert.equal(imported.status, "APPROVED");
  assert.equal(imported.sourceCheckpointId, undefined);
  assert.equal(imported.externalSource.nodeId, "result-uuid");
  assert.deepEqual(imported.externalSource.sourceNodeIds, ["source-uuid"]);
  assert.equal(
    saved.checkpoints.find((c) => c.attemptId === imported.id).externalSource
      .nodeId,
    "result-uuid",
  );
  assert.ok(!JSON.stringify(saved).includes("ak_mock_not_real"));
  await bridge
    .getByRole("button", { name: "Load selected image", exact: true })
    .click();
  await bridge
    .getByRole("button", { name: "Save as Checkpoint", exact: true })
    .click();
  await expect(bridge.getByRole("alert")).toContainText("already imported");
  assert.equal((await read()).attempts.length, saved.attempts.length);
  await bridge
    .getByRole("button", { name: "Prepare Retry on Canvas", exact: true })
    .click();
  await expect(bridge.getByLabel("Handoff prompt")).toHaveValue(
    /A bottle in soft light/,
  );
  const write = bridge.getByRole("button", {
    name: "Confirm · Create FLORA node",
    exact: true,
  });
  await expect(write).toBeDisabled();
  assert.equal(
    (await worker.evaluate(() => globalThis.bridgeCalls)).filter(
      (c) => c.method === "POST",
    ).length,
    0,
  );
  for (const width of [320, 360, 480, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await bridge.locator(".handoff-preview").scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/phase4-mock-handoff-${width}.png`,
    });
  }
  await bridge
    .getByLabel(
      "I confirm creating this new node in the selected FLORA project.",
    )
    .check();
  await write.click();
  await expect(
    bridge.getByText(
      "New FLORA image node prepared. No generation was started.",
      { exact: true },
    ),
  ).toBeVisible();
  const writes = (await worker.evaluate(() => globalThis.bridgeCalls)).filter(
    (c) => c.method === "POST",
  );
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body);
  assert.equal(body.connect[0].from, "result-uuid");
  assert.equal(body.add[0].type, "image");
  assert.ok(
    !writes.some(
      (c) => c.path.includes("/run") || c.path.includes("/generate"),
    ),
  );
  await bridge
    .getByRole("button", { name: "Disconnect FLORA", exact: true })
    .click();
  assert.equal(
    await worker.evaluate(async () =>
      Boolean(
        (await chrome.storage.session.get("floraCredential")).floraCredential,
      ),
    ),
    false,
  );
  assert.equal((await read()).attempts.length, saved.attempts.length);
  await expect(bridge.getByLabel("FLORA workspace")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Phase 04 MOCKED API smoke: authentication error/success, workspaces/projects, canonical nodes, text, image download/import/approval/provenance, duplicates, preview/explicit confirmed non-generation changeset, disconnect retains local data, 320/360/480/1440px. No real FLORA account or native permission dialog tested.",
  );
} catch (e) {
  if (page) await page.screenshot({ path: "artifacts/phase4-error.png" });
  throw e;
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
}
