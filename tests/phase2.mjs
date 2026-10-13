import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "preserve-phase2-"));
const extension = path.resolve("dist");
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
let context = await launch();
let page;
const errors = [];
const button = (name) => page.getByRole("button", { name, exact: true });
async function snapshot() {
  return page.evaluate(async () => {
    const d = await new Promise((resolve, reject) => {
      const r = indexedDB.open("preserve");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = {};
    for (const name of ["stages", "attempts", "checkpoints"]) {
      const rows = await new Promise((resolve) => {
        const r = d.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
      });
      for (const a of rows) {
        if (a.image) {
          a.image = {
            type: a.image.type,
            size: a.image.size,
            hash: Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  await a.image.arrayBuffer(),
                ),
              ),
            ).join(","),
          };
        }
      }
      result[name] = rows;
    }
    d.close();
    return result;
  });
}
async function fixture(title, color) {
  const data = await page.evaluate(
    ({ title, color }) => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = "#F5F2E9";
      ctx.fillRect(250, 120, 140, 250);
      ctx.fillStyle = "#20374A";
      ctx.font = "24px Georgia";
      ctx.fillText(title, 34, 420);
      return c.toDataURL("image/png").split(",")[1];
    },
    { title, color },
  );
  return {
    name: title + ".png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
}
async function upload(title, color) {
  await page
    .getByLabel("Upload image", { exact: true })
    .setInputFiles(await fixture(title, color));
}
async function subject(text) {
  const d = page.locator(".direction-details");
  if (!(await d.evaluate((e) => e.open)))
    await d.locator("summary").first().click();
  const edit = page.getByText("Edit details", { exact: true });
  const parent = edit.locator("..");
  if (!(await parent.evaluate((e) => e.open))) await edit.click();
  await page.getByLabel("Subject", { exact: true }).fill(text);
}
async function stage(id) {
  await button("Workflow").click();
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(id);
  await button("Open selected notebook").click();
}
try {
  let worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const url = `chrome-extension://${new URL(worker.url()).host}/index.html`;
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await button("New project").click();
  const create = page.getByRole("dialog", { name: "A new notebook" });
  await create.locator('input[name="name"]').fill("Phase 02 — Decision study");
  await create
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.locator(".canvas-node")).toHaveCount(4);
  let data = await snapshot();
  const stages = data.stages.sort((a, b) => a.order - b.order);
  await stage(stages[0].id);
  await button("New iteration").click();
  await upload("Original product", "#667D69");
  await subject("Preserve the original product");
  await button("Keep this version").click();
  await page
    .getByRole("heading", { name: "A reference worth keeping.", exact: true })
    .waitFor();
  await stage(stages[1].id);
  await button("New iteration").click();
  await upload("Model and product", "#536A60");
  await subject("Introduce the model");
  await page
    .getByText("Edit preservation requirements", { exact: true })
    .click();
  await page
    .getByLabel("Known failure points", { exact: true })
    .fill("Check the logo typography");
  await button("Keep this version").click();
  await page
    .getByRole("heading", { name: "A reference worth keeping.", exact: true })
    .waitFor();
  await stage(stages[2].id);
  await button("New iteration").click();
  await upload("First direction", "#B36E4E");
  await subject("First stage three direction");
  await page
    .getByLabel("Notes on this image", { exact: true })
    .fill("Product label distorted.");
  await button("What didn't work?").click();
  await page.getByLabel("Product details changed", { exact: true }).check();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Product label distorted.");
  await button("Save revision note").click();
  await expect(
    page.getByRole("dialog", { name: "What didn’t work?" }),
  ).toBeHidden();
  await expect
    .poll(
      async () =>
        (await snapshot()).attempts.filter((a) => a.status === "REJECTED")
          .length,
    )
    .toBe(1);
  data = await snapshot();
  const failed = data.attempts.find((a) => a.status === "REJECTED");
  const cp2 = data.checkpoints.find((c) => c.stageId === stages[1].id);
  assert.equal(failed.sourceCheckpointId, cp2.id);
  await button("Return to this checkpoint").click();
  await expect(
    page.getByLabel("Notes on this image", { exact: true }),
  ).toHaveValue("");
  await upload("Second direction", "#667D69");
  await subject("Second stage three direction");
  await page
    .getByLabel("Notes on this image", { exact: true })
    .fill("Logo corrected; keep the model pose.");
  await button("Save notes").click();
  await expect(
    page.getByText("Notes not yet saved", { exact: true }),
  ).toHaveCount(0);
  data = await snapshot();
  const next = data.attempts.find((a) => a.parentIterationId === failed.id);
  assert.equal(next.sourceCheckpointId, cp2.id);
  assert.equal(next.contract.knownFailurePoints, "Check the logo typography");
  assert.deepEqual(
    data.attempts.find((a) => a.id === failed.id),
    failed,
  );
  await button("Compare images").click();
  const compare = page.getByRole("dialog", { name: "Side by side" });
  await expect(compare.locator("img")).toHaveCount(2);
  await button("Before / after").click();
  await page.getByLabel("Before / after position", { exact: true }).fill("37");
  await expect(page.locator(".comparison-before")).toHaveCSS(
    "clip-path",
    "inset(0px 63% 0px 0px)",
  );
  await button("Comparison zoom in").click();
  await expect(page.getByLabel("Comparison zoom", { exact: true })).toHaveText(
    "125%",
  );
  const image = page.locator(".comparison-wipe");
  const box = await image.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + 65);
  await page.mouse.up();
  const transforms = await page
    .locator(".comparison-transform")
    .evaluateAll((els) => els.map((e) => e.style.transform));
  assert.equal(transforms[0], transforms[1]);
  assert.match(transforms[0], /translate\(35px, 25px\)/);
  await button("Fullscreen inspection").click();
  await expect(page.locator(".inspection-fullscreen")).toBeVisible();
  await fs.mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/phase2-comparison-desktop.png" });
  await button("Exit fullscreen").click();
  await button("Keep image 1").click();
  await expect(
    compare.getByText("Image 1 · Kept", { exact: true }),
  ).toBeVisible();
  await button("Close Side by side").click();
  // Moving a node persists only its visual coordinates, never order or image lineage.
  await button("Workflow").click();
  if (await button("Close iterations").isVisible())
    await button("Close iterations").click();
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(stages[1].id);
  await button("Close iterations").click();
  const beforeMove = await snapshot();
  const grip = page.getByRole("button", { name: "Move stage 2", exact: true });
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + 12, g.y + 12);
  await page.mouse.down();
  await page.mouse.move(g.x + 172, g.y + 82, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Boolean(
        (await snapshot()).stages.find((s) => s.id === stages[1].id)
          .visualPosition,
      ),
    )
    .toBe(true);
  data = await snapshot();
  assert.deepEqual(data.attempts, beforeMove.attempts);
  assert.deepEqual(data.checkpoints, beforeMove.checkpoints);
  assert.deepEqual(
    data.stages.map((s) => s.order),
    beforeMove.stages.map((s) => s.order),
  );
  // Visual handles create a new stage-four draft from the selected approved image.
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(stages[1].id);
  const sourceHandle = page.getByRole("button", {
    name: "Connect reference from stage 2",
    exact: true,
  });
  await sourceHandle.focus();
  await sourceHandle.press("Enter");
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(stages[3].id);
  await page
    .getByRole("button", { name: "Use reference in stage 4", exact: true })
    .click();
  await page.getByRole("heading", { name: "Approved Reference", exact: true }).waitFor();
  data = await snapshot();
  assert.equal(
    data.attempts.find((a) => a.stageId === stages[3].id).sourceCheckpointId,
    cp2.id,
  );
  // Branching a previously approved iteration leaves its checkpoint and downstream work intact.
  await stage(stages[1].id);
  await button("Branch this iteration").click();
  await expect
    .poll(
      async () =>
        (await snapshot()).attempts.filter((a) => a.stageId === stages[1].id)
          .length,
    )
    .toBe(2);
  data = await snapshot();
  assert.equal(
    data.stages.find((s) => s.id === stages[1].id).currentCheckpointId,
    cp2.id,
  );
  assert.equal(
    data.attempts.filter((a) => a.stageId === stages[1].id).length,
    2,
  );
  const finalData = await snapshot();
  await page.reload();
  await expect(page.getByLabel("Active project", { exact: true })).toHaveValue(
    stages[0].workflowId,
  );
  assert.deepEqual(await snapshot(), finalData);
  await context.close();
  context = await launch();
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  page = await context.newPage();
  await page.goto(url);
  await expect(page.locator(".canvas-node")).toHaveCount(4);
  assert.deepEqual(await snapshot(), finalData);
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(stages[2].id);
  await page.screenshot({ path: "artifacts/phase2-canvas-desktop.png" });
  await page.setViewportSize({ width: 375, height: 1000 });
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(stages[2].id);
  await page.screenshot({ path: "artifacts/phase2-canvas-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await button("Open selected notebook").click();
  await button("Compare images").click();
  await button("Before / after").click();
  await expect(page.locator(".visual-comparison img")).toHaveCount(2);
  await page
    .locator(".visual-comparison img")
    .evaluateAll((imgs) => Promise.all(imgs.map((img) => img.decode())));
  await page.screenshot({ path: "artifacts/phase2-comparison-mobile.png" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );

  await button("Close Side by side").click();
  await button("Workflow").click();
  const cdp = await context.newCDPSession(page);
  const viewport = page.getByRole("region", {
    name: "Interactive workflow canvas",
  });
  const vb = await viewport.boundingBox();
  const beforeTouch = await page.locator(".graph-world").getAttribute("style");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: vb.x + 10, y: vb.y + 30 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: vb.x + 30, y: vb.y + 80 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".graph-world")).not.toHaveAttribute(
    "style",
    beforeTouch,
  );
  const beforePinch = await page
    .getByLabel("Canvas zoom", { exact: true })
    .innerText();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: vb.x + 10, y: vb.y + 70 },
      { id: 2, x: vb.x + 45, y: vb.y + 120 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: vb.x + 5, y: vb.y + 45 },
      { id: 2, x: vb.x + 80, y: vb.y + 160 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByLabel("Canvas zoom", { exact: true })).not.toHaveText(
    beforePinch,
  );
  assert.deepEqual((await snapshot()).attempts, finalData.attempts);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(stages[0].id);
  await page
    .getByRole("button", {
      name: "Select stage 1: Product Studio Shot",
      exact: true,
    })
    .dblclick();
  await expect(
    page.getByRole("heading", {
      name: "Stage 01 / Product Studio Shot",
      exact: true,
    }),
  ).toBeVisible();

  assert.deepEqual(errors, []);
  console.log(
    "PASS: four-stage approval/rejection/checkpoint return, immutable branching, two-image comparison/slider/fullscreen/synchronized pan+zoom, visual handle connection, position-only rearrangement, reload and browser restart.",
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ path: "artifacts/phase2-error.png" })
      .catch(() => {});
  throw e;
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
}
