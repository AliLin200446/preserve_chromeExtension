import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "preserve-phase3-"));
const extension = path.resolve("dist");
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 360, height: 1000 },
    reducedMotion: "reduce",
  });
let context = await launch(),
  page,
  workspace;
const errors = [];
async function data() {
  return page.evaluate(async () => {
    const d = await new Promise((resolve) => {
      const r = indexedDB.open("preserve");
      r.onsuccess = () => resolve(r.result);
    });
    const out = { version: d.version };
    for (const name of [
      "attempts",
      "checkpoints",
      "annotations",
      "imageVersions",
    ]) {
      out[name] = await new Promise((resolve) => {
        const r = d.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
      });
      for (const row of out[name])
        if (row.image) {
          row.image = {
            hash: Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  await row.image.arrayBuffer(),
                ),
              ),
            ).join(","),
            type: row.image.type,
            size: row.image.size,
          };
        }
    }
    d.close();
    return out;
  });
}
const button = (name, root = page) =>
  root.getByRole("button", { name, exact: true });
const review = () =>
  page.getByRole("dialog", { name: "Compare with Reference" });
async function imageHash(root) {
  return root
    .locator(".review-frame img")
    .evaluate(async (img) => {
      const blob = await fetch(img.src).then((r) => r.blob());
      return Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
      ).join(",");
    })
    .catch(() => "__loading__");
}
try {
  let worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const url = `chrome-extension://${new URL(worker.url()).host}/index.html`;
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await button("Explore a sample notebook").click();
  await button("Notebook").click();
  await button("Open iteration 01: For revision").click();
  const before = await data();
  const failed = before.attempts.find((a) => a.status === "REJECTED");
  const cp = before.checkpoints.find((c) => c.id === failed.sourceCheckpointId);
  await button("Compare with Reference").click();
  await expect(review()).toBeVisible();
  await expect(review().locator(".review-frame img")).toHaveCount(1);
  await expect.poll(() => imageHash(review())).toBe(failed.image.hash);
  await button("Last Approved Reference", review()).click();
  await expect.poll(() => imageHash(review())).toBe(cp.image.hash);
  await button("Current Iteration", review()).click();
  await expect(button("Before / after", review())).toBeDisabled();
  await review()
    .getByLabel("These images have comparable framing. Link their views.")
    .check();
  await button("Before / after", review()).click();
  await review().getByLabel("Reference comparison position").fill("38");
  await expect(review().locator(".review-slider-before")).toHaveCSS(
    "clip-path",
    "inset(0px 62% 0px 0px)",
  );
  await button("Place pin", review()).click();
  await expect(review().locator(".review-frame img")).toHaveCount(1);
  await review()
    .locator(".review-frame img")
    .evaluate((img) => img.decode());
  const plane = review().locator(".review-image-plane");
  const rect = await plane.boundingBox();
  await plane.click({
    position: { x: rect.width * 0.44, y: rect.height * 0.62 },
  });
  await review()
    .getByLabel("Annotation note", { exact: true })
    .fill("The logo changed.");
  await review()
    .getByLabel("Annotation category", { exact: true })
    .selectOption("Logo / Typography");
  await button("Save annotation", review()).click();
  await expect(review().locator(".annotation-pin")).toHaveCount(1);
  let snapshot = await data();
  assert.equal(snapshot.version, 20);
  assert.equal(snapshot.annotations.length, 1);
  const pin = snapshot.annotations[0];
  assert.ok(Math.abs(pin.x - 0.44) < 0.01 && Math.abs(pin.y - 0.62) < 0.01);
  assert.equal(pin.attemptId, failed.id);
  assert.equal(pin.category, "Logo / Typography");
  assert.deepEqual(snapshot.attempts, before.attempts);
  assert.deepEqual(snapshot.checkpoints, before.checkpoints);
  await button("Review zoom in", review()).click();
  await expect(review().getByLabel("Review zoom", { exact: true })).toHaveText(
    "125%",
  );
  await button("Fit images", review()).click();
  for (const width of [320, 360, 480]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(review().locator(".review-frame img")).toHaveCount(1);
    assert.ok(
      await review().evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await review().evaluate((el) => el.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/phase3-review-${width}.png` });
  }
  await button("Close Compare with Reference").click();
  await button("Compare with Reference").click();
  await expect(review().locator(".annotation-pin")).toHaveCount(1);
  await expect(
    review().getByText("The logo changed.", { exact: true }),
  ).toBeVisible();
  await button("Close Compare with Reference").click();
  const popup = context.waitForEvent("page");
  await button("Open Review Workspace ↗").click();
  workspace = await popup;
  await workspace.setViewportSize({ width: 1500, height: 1100 });
  workspace.on("pageerror", (e) => errors.push(e.message));
  await expect(
    workspace.getByRole("heading", { name: "Review workspace" }),
  ).toBeVisible();
  await expect(workspace.locator(".annotation-pin")).toHaveCount(1);
  await expect(workspace.locator(".review-frame img")).toHaveCount(2);
  await workspace.screenshot({ path: "artifacts/phase3-review-workspace.png" });
  await workspace.locator(".annotation-entry").first().click();
  await workspace
    .getByLabel("Annotation note", { exact: true })
    .fill("The logo changed. Preserve its typography.");
  await button("Save annotation", workspace).click();
  await expect
    .poll(async () => (await data()).annotations[0].note)
    .toBe("The logo changed. Preserve its typography.");
  await button("Add pin at center", workspace).click();
  await workspace
    .getByLabel("Annotation note", { exact: true })
    .fill("Temporary second pin");
  await button("Save annotation", workspace).click();
  await expect(workspace.locator(".annotation-pin")).toHaveCount(2);
  await button("Remove annotation", workspace).click();
  await expect(workspace.locator(".annotation-pin")).toHaveCount(1);
  await button("Compare with Reference").click();
  await expect(
    review().getByText("The logo changed. Preserve its typography.", {
      exact: true,
    }),
  ).toBeVisible();
  // Two editors must not overwrite or remove a newer annotation silently.
  await review().locator(".annotation-entry").first().click();
  await review()
    .getByLabel("Annotation note", { exact: true })
    .fill("My pending local note");
  await workspace.locator(".annotation-entry").first().click();
  const newerNote =
    "The logo changed. Preserve its typography. Keep the exact lettering.";
  await workspace
    .getByLabel("Annotation note", { exact: true })
    .fill(newerNote);
  await button("Save annotation", workspace).click();
  await expect
    .poll(async () => (await data()).annotations[0].note)
    .toBe(newerNote);
  await button("Save annotation", review()).click();
  await expect(review().getByRole("alert")).toContainText(
    "changed in another view",
  );
  await expect(
    review().getByLabel("Annotation note", { exact: true }),
  ).toHaveValue("My pending local note");
  await button("Remove annotation", review()).click();
  await expect(review().getByRole("alert")).toContainText("before removing it");
  assert.equal((await data()).annotations[0].note, newerNote);
  page.once("dialog", (dialog) => dialog.accept());
  await button("Close annotation", review()).click();
  await review()
    .getByLabel("Review next direction")
    .fill("Keep the model pose. Restore the original logo.");
  await review().getByText("Retry prompt preview", { exact: true }).click();
  await expect(review().getByLabel("Retry prompt preview")).toHaveValue(
    /Logo \/ Typography.*The logo changed/s,
  );
  await review().getByText("Full retry brief", { exact: true }).click();
  await expect(review().getByLabel("Full retry brief")).toHaveValue(
    /ANNOTATION NOTES/,
  );
  await button("Try Again from Approved Reference", review()).click();
  await expect(review()).toBeHidden();
  await expect(
    page.getByLabel("Next generation instructions", { exact: true }),
  ).toHaveValue("Keep the model pose. Restore the original logo.");
  snapshot = await data();
  const next = snapshot.attempts.find(
    (a) =>
      a.revisionContext?.parentIterationId === failed.id &&
      !before.attempts.some((old) => old.id === a.id),
  );
  assert.ok(next);
  assert.equal(next.sourceCheckpointId, cp.id);
  assert.equal(next.revisionContext.annotations[0].id, pin.id);
  assert.deepEqual(next.contract.attributes, failed.contract.attributes);
  assert.deepEqual(
    snapshot.attempts.find((a) => a.id === failed.id),
    failed,
  );
  assert.equal(snapshot.annotations.length, 1);
  await page.getByText("Retry prompt preview", { exact: true }).click();
  await expect(
    page.getByLabel("Retry prompt preview", { exact: true }),
  ).toHaveValue(/Restore the original logo/);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await button("Copy Retry Prompt").click();
  const concise = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(concise, /The logo changed/);
  assert.ok(!concise.includes(pin.imageVersionId));
  await button("Copy Full Retry Brief").click();
  const full = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(full.includes(pin.imageVersionId));
  const png = await page.screenshot();
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "manually-generated-result.png",
    mimeType: "image/png",
    buffer: png,
  });
  await button("Save notes").click();
  await button("Compare with Reference").click();
  await expect(review().locator(".review-frame img")).toHaveCount(1);
  await button("Last Approved Reference", review()).click();
  await expect.poll(() => imageHash(review())).toBe(cp.image.hash);
  await button("Close Compare with Reference").click();
  await button("Keep this version").click();
  await page
    .getByRole("heading", { name: "A reference worth keeping.", exact: true })
    .waitFor();
  const final = await data();
  assert.equal(final.attempts.find((a) => a.id === next.id).status, "APPROVED");
  assert.equal(
    final.attempts.find((a) => a.id === failed.id).status,
    "REJECTED",
  );
  assert.equal(final.annotations[0].imageVersionId, pin.imageVersionId);
  await workspace.close();
  await context.close();
  context = await launch();
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  page = await context.newPage();
  await page.goto(url + "#notebook");
  await page
    .getByRole("heading", { name: "Approved Reference", exact: true })
    .waitFor();
  assert.deepEqual(await data(), final);
  await button("Open iteration 01: For revision").click();
  await button("Compare with Reference").click();
  await expect(review().locator(".annotation-pin")).toHaveCount(1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Phase 03: actual source/output selection; normalized pins; edit/remove and restart persistence; shared review workspace; annotated retry provenance and two copy formats; manual upload, same-source review, approval; immutable old records; 320/360/480px layouts.",
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ path: "artifacts/phase3-error.png" })
      .catch(() => {});
  throw e;
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
}
