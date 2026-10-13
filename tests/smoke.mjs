import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "preserve-notebook-"));
const extension = path.resolve("dist");
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 390, height: 900 },
  });
let context = await launch();
let page;
const errors = [];
const notebookData = () =>
  page.evaluate(async () => {
    const d = await new Promise((resolve, reject) => {
      const r = indexedDB.open("preserve");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data = {};
    for (const s of ["attempts", "checkpoints", "stages"]) {
      data[s] = await new Promise((resolve, reject) => {
        const r = d.transaction(s).objectStore(s).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    d.close();
    return data;
  });
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const url = `chrome-extension://${new URL(worker.url()).host}/index.html`;
  page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Make room for the process." })
    .waitFor();
  await page.getByRole("button", { name: "Explore a sample notebook" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("heading", { name: "Workflow", exact: true }).waitFor();
  await page.locator('main[aria-busy="false"]').waitFor();
  await fs.mkdir("artifacts", { recursive: true });
  for (const width of [320, 360, 375, 480, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.locator(".workflow-node").count(), 4);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "artifacts/workflow-map-" + width + ".png",
      fullPage: true,
    });
  }
  const originalGraphData = await notebookData();
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "Open Canvas", exact: true }).click();
  const canvas = await popup;
  canvas.on("pageerror", (e) => errors.push(e.message));
  await canvas.emulateMedia({ reducedMotion: "reduce" });
  await canvas.setViewportSize({ width: 1600, height: 1100 });
  await canvas
    .getByRole("heading", { name: "Workflow canvas", exact: true })
    .waitFor();
  assert.match(canvas.url(), /chrome-extension:\/\/.*\/canvas.html/);
  await expect(canvas.locator(".canvas-node")).toHaveCount(4);
  await expect(canvas.locator('[data-edge-kind="order"]')).toHaveCount(3);
  await expect(canvas.locator('[data-edge-kind="reference"]')).toHaveCount(2);
  await canvas
    .getByRole("button", { name: "Fit to view", exact: true })
    .click();
  await canvas.screenshot({ path: "artifacts/workflow-canvas.png" });
  const transform = await canvas.locator(".graph-world").getAttribute("style");
  await canvas.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(canvas.locator(".graph-world")).not.toHaveAttribute(
    "style",
    transform,
  );
  const region = canvas.getByRole("region", {
    name: "Interactive workflow canvas",
  });
  await region.focus();
  const beforePan = await canvas.locator(".graph-world").getAttribute("style");
  await canvas.keyboard.press("ArrowRight");
  await expect(canvas.locator(".graph-world")).not.toHaveAttribute(
    "style",
    beforePan,
  );
  const box = await region.boundingBox();
  const beforeDrag = await canvas.locator(".graph-world").getAttribute("style");
  await canvas.mouse.move(box.x + 12, box.y + 12);
  await canvas.mouse.down();
  await canvas.mouse.move(box.x + 72, box.y + 40, { steps: 4 });
  await canvas.mouse.up();
  await expect(canvas.locator(".graph-world")).not.toHaveAttribute(
    "style",
    beforeDrag,
  );
  const beforeWheel = await canvas
    .getByLabel("Canvas zoom", { exact: true })
    .innerText();
  await canvas.mouse.wheel(0, -140);
  await expect(
    canvas.getByLabel("Canvas zoom", { exact: true }),
  ).not.toHaveText(beforeWheel);
  const s2 = originalGraphData.stages.find((s) => s.order === 1);
  const s3 = originalGraphData.stages.find((s) => s.order === 2);
  await canvas
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(s2.id);
  await expect(
    page.getByRole("button", {
      name: "Open stage 02: Model Shot",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "step");
  await canvas
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(s3.id);
  await canvas
    .getByRole("button", { name: "Open selected notebook", exact: true })
    .click();
  await canvas
    .getByRole("heading", { name: "Approved Reference", exact: true })
    .waitFor();
  await expect(
    page.getByRole("button", {
      name: "Open stage 03: Model + Product Ad Shot",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "step");
  await canvas
    .getByRole("button", { name: "Back to workflow", exact: true })
    .click();
  await canvas
    .getByRole("heading", { name: "Workflow canvas", exact: true })
    .waitFor();
  await canvas
    .getByRole("button", { name: "Open selected notebook", exact: true })
    .click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page
    .getByLabel("Notes on this image", { exact: true })
    .fill("Unsaved across two views");
  await canvas
    .getByRole("button", {
      name: "Open iteration 01: For revision",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Keep working here", exact: true })
    .waitFor();
  await expect(
    page.getByLabel("Notes on this image", { exact: true }),
  ).toHaveValue("Unsaved across two views");
  await page
    .getByRole("button", { name: "Keep working here", exact: true })
    .click();
  await expect(
    canvas.getByRole("button", {
      name: "Open iteration 02: In the making",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Open stage 02: Model Shot", exact: true })
    .click();
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await canvas
    .getByRole("button", { name: "Back to workflow", exact: true })
    .click();
  await canvas
    .getByLabel("Select canvas stage", { exact: true })
    .selectOption(s3.id);
  await expect(
    page.getByRole("button", {
      name: "Open stage 03: Model + Product Ad Shot",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "step");
  const graphDataAfter = await notebookData();
  assert.deepEqual(
    graphDataAfter,
    originalGraphData,
    "Camera and selection must not change domain data",
  );
  await canvas.close();
  await page.setViewportSize({ width: 390, height: 900 });
  await page
    .getByRole("button", {
      name: "Open stage 03: Model + Product Ad Shot",
      exact: true,
    })
    .click();
  await page.getByRole("heading", { name: "Approved Reference", exact: true }).waitFor();
  await page.locator('main[aria-busy="false"]').waitFor();
  await expect(
    page.getByRole("heading", {
      name: "Stage 03 / Model + Product Ad Shot",
      exact: true,
    }),
  ).toBeVisible();
  let before = await notebookData();
  const failed = before.attempts.find((a) => a.status === "REJECTED");
  const initialRetry = before.attempts.find(
    (a) => a.previousAttemptId === failed.id,
  );
  const cp = before.checkpoints.find(
    (c) => c.id === initialRetry.sourceCheckpointId,
  );
  assert.equal(
    cp.attemptId,
    before.attempts.find((a) => a.stageId === cp.stageId).id,
  );
  await fs.mkdir("artifacts", { recursive: true });
  for (const width of [320, 360, 375, 480, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `artifacts/notebook-chapter-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Horizontal overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: "artifacts/notebook-project.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "artifacts/notebook-reference.png" });
  await page
    .getByRole("button", {
      name: "Open iteration 01: For revision",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open iteration 01: For revision",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const el = document.getElementById("iterations");
    scrollTo({
      top:
        el.getBoundingClientRect().top +
        scrollY -
        document.querySelector("header").getBoundingClientRect().height -
        12,
      behavior: "instant",
    });
  });
  await page.screenshot({ path: "artifacts/notebook-contact-sheet.png" });
  await page
    .getByRole("button", {
      name: "Open iteration 02: In the making",
      exact: true,
    })
    .click();
  const note = "The image needs a quieter background.";
  await page.getByLabel("Notes on this image", { exact: true }).fill(note);
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(
    page.getByText("Notes not yet saved", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByLabel("Notes on this image", { exact: true }),
  ).toHaveValue(note);
  await page
    .getByRole("button", { name: "Compare images", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Side by side" }).waitFor();
  assert.ok(
    await page.evaluate(() => !!document.activeElement.closest("dialog")),
    "Dialog takes keyboard focus",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Side by side" })).toBeHidden();
  await page
    .getByRole("button", { name: "What didn't work?", exact: true })
    .click();
  await page.getByLabel("Product details changed", { exact: true }).check();
  await page
    .getByLabel("Revision note", { exact: true })
    .fill("The logo no longer matches.");
  await page
    .getByRole("button", { name: "Save revision note", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Try again from approved reference",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open iteration 03: In the making",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".direction-details > summary").click();
  await page.getByText("Edit next direction", { exact: true }).click();
  await expect(page.getByLabel("Next direction", { exact: true })).toHaveValue(
    /The logo no longer matches/,
  );
  let after = await notebookData();
  const retry = after.attempts.find(
    (a) => a.previousAttemptId === initialRetry.id,
  );
  assert.equal(retry.sourceCheckpointId, cp.id);
  assert.equal(
    after.attempts.find((a) => a.id === initialRetry.id).status,
    "REJECTED",
  );
  assert.deepEqual(
    after.attempts.find((a) => a.id === initialRetry.id).failure.categories,
    ["Product fidelity"],
  );
  assert.deepEqual(retry.contract.attributes, cp.contract.attributes);
  await page.getByText("Edit details", { exact: true }).click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("An editorial portrait with the original bottle");
  await page
    .getByRole("button", { name: "Write direction", exact: true })
    .click();
  await page
    .getByLabel("In your own words", { exact: true })
    .fill("Quiet, warm, and grounded.");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(
    page.getByText("Notes not yet saved", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("View structured prompt", { exact: true }).click();
  await expect(page.getByLabel("Compiled prompt", { exact: true })).toHaveValue(
    /Quiet, warm, and grounded/,
  );
  const image = await page.screenshot();
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "output.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(page.getByText("Replace image", { exact: true })).toBeVisible();
  const keepButton = page.getByRole("button", {
    name: "Keep this version",
    exact: true,
  });
  await keepButton.scrollIntoViewIfNeeded();
  assert.ok(
    await keepButton.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
    "Sticky controls do not cover the keep action",
  );
  await keepButton.click();
  await page
    .getByRole("heading", { name: "A reference worth keeping." })
    .waitFor();
  after = await notebookData();
  assert.equal(after.checkpoints.length, before.checkpoints.length + 1);
  assert.equal(after.attempts.filter((a) => a.status === "REJECTED").length, 2);
  await page
    .getByRole("button", { name: "Version history", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Version history", exact: true })
    .waitFor();
  await expect(
    page.locator("main").getByText("For revision", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Restore as a new iteration", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Keep this version", exact: true })
    .waitFor();
  let restored = await notebookData();
  assert.equal(restored.checkpoints.length, after.checkpoints.length);
  assert.equal(restored.attempts.length, after.attempts.length + 1);
  // Reduced viewport approximates the layout width available after 200% browser zoom.
  await page.setViewportSize({ width: 180, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Overflow at 200% equivalent of 360px",
  );
  await page.setViewportSize({ width: 360, height: 900 });
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "Approved Reference", exact: true }).waitFor();
  const behavior = await worker.evaluate(() =>
    chrome.sidePanel.getPanelBehavior(),
  );
  assert.equal(behavior.openPanelOnActionClick, true);
  const savedProject = await page
    .getByLabel("Active project", { exact: true })
    .inputValue();
  await context.close();
  context = await launch();
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.goto(url);
  await expect(page.getByLabel("Active project", { exact: true })).toHaveValue(
    savedProject,
  );
  assert.equal(
    (await notebookData()).attempts.length,
    restored.attempts.length,
  );
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A new notebook" });
  await dialog.locator('input[name="name"]').fill("A study in afternoon light");
  await dialog.locator('select[name="template"]').selectOption("empty");
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.locator('select[aria-label="Active project"] option:checked'),
  ).toHaveText("A study in afternoon light");
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.locator(".chapter-index > summary").click();
  page.once("dialog", (d) => d.accept("The encounter"));
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await page
    .getByRole("heading", { name: /Stage \d+ \/ The encounter/ })
    .waitFor();
  await page.getByLabel("Stage options", { exact: true }).click();
  await page
    .getByRole("button", { name: "Move chapter earlier", exact: true })
    .click();
  await expect(page.locator(".chapter-heading h1")).toContainText("Stage 01");
  await page
    .getByRole("button", { name: "New iteration", exact: true })
    .click();
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Use a PNG, JPEG, or WebP",
  );

  await page
    .getByRole("button", { name: "Dismiss message", exact: true })
    .click();
  await page
    .getByLabel("Notes on this image", { exact: true })
    .fill("Unsaved observation");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue The encounter", exact: true })
    .click();
  // Navigation to another chapter must ask before discarding unsaved edits.
  await page.getByRole("button", { name: "Next chapter", exact: true }).click();
  await expect(
    page.getByLabel("Notes on this image", { exact: true }),
  ).toHaveValue("Unsaved observation");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect(
    page.getByText("Notes not yet saved", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Active project", { exact: true })
    .selectOption(savedProject);
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Open iteration 01: For revision",
      exact: true,
    })
    .waitFor();
  await page.locator(".chapter-index > summary").click();
  await page.getByRole("button", { name: /02 Model Shot/ }).click();
  await page.getByLabel("Stage options", { exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete chapter", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Open iteration 01: For revision",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "This reference is no longer available.",
      exact: true,
    })
    .waitFor();
  await expect(
    page.getByRole("button", {
      name: "Try again from approved reference",
      exact: true,
    }),
  ).toHaveCount(0);
  const beforeReorder = await notebookData();
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  const sourceNode = page.locator(
    '.vertical-flow li[data-stage-id="' + failed.stageId + '"] .workflow-node',
  );
  await sourceNode.locator("summary").click();
  page.once("dialog", (d) => d.accept("Alternate direction"));
  await sourceNode
    .getByRole("button", { name: "Add stage after", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Open stage 03: Alternate direction/ })
    .waitFor();
  const alternative = page.locator(".workflow-node").filter({
    has: page.getByRole("button", {
      name: /Open stage 03: Alternate direction/,
    }),
  });
  await alternative.locator("summary").click();
  await alternative
    .getByRole("button", { name: "Move up", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Open stage 02: Alternate direction/ })
    .waitFor();
  assert.deepEqual(
    (await notebookData()).attempts,
    beforeReorder.attempts,
    "Stage controls cannot rewrite attempt lineage",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: side-panel graph, dedicated canvas, pan/zoom/fit, cross-tab selection, map/notebook navigation, stage controls, notebook workflows, approved source inheritance, category compatibility, deterministic prompts, retry lineage, retained history, restore, local restart/offline use, chapter management, upload validation, 320/360/480px and 200% equivalent layout.",
  );
} catch (error) {
  if (page) {
    await page.screenshot({
      path: "artifacts/notebook-failure.png",
      fullPage: true,
    });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
}
