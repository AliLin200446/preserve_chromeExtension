import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const capture = process.argv.includes("--capture");
const stateFile = path.resolve("artifacts/legacy-profile.json");
const state = capture
  ? { profile: await fs.mkdtemp(path.join(os.tmpdir(), "preserve-legacy-")) }
  : JSON.parse(await fs.readFile(stateFile, "utf8"));
const extension = path.resolve("dist");
const context = await chromium.launchPersistentContext(state.profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 360, height: 900 },
});
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/index.html`,
  );
  if (capture) {
    await page
      .getByRole("button", {
        name: /Create Demo Project|Explore a sample notebook/,
      })
      .click();
    await page.locator('main[aria-busy="false"]').waitFor();
    await page
      .getByRole("heading", {
        name: /Creative workflow|The reference|Reference|Workflow/,
      })
      .waitFor();
  } else {
    await page
      .getByRole("heading", { name: /The reference|Reference|Workflow/ })
      .waitFor();
  }
  const data = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("preserve");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const snapshot = { version: database.version };
    for (const store of [
      "workflows",
      "stages",
      "attempts",
      "checkpoints",
      "settings",
    ]) {
      const rows = await new Promise((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const row of rows)
        if (row.image instanceof Blob) {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            await row.image.arrayBuffer(),
          );
          row.image = {
            type: row.image.type,
            size: row.image.size,
            sha256: Array.from(new Uint8Array(digest))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          };
        }
      snapshot[store] = rows;
    }
    database.close();
    return snapshot;
  });
  if (capture) {
    state.data = data;
    await fs.writeFile(stateFile, JSON.stringify(state));
    console.log(
      "Captured previous-build browser profile: " +
        data.attempts.length +
        " attempts, " +
        data.checkpoints.length +
        " checkpoints.",
    );
  } else {
    assert.equal(data.version, 20);
    assert.deepEqual(JSON.parse(JSON.stringify({...data,version:state.data.version})), state.data);
    await expect(page.getByLabel("Active project")).toHaveValue(
      state.data.workflows[0].id,
    );
    console.log(
      "PASS: existing v1 records, relationships, prompt/contract snapshots and image bytes remain identical after upgrade and browser restart.",
    );
  }
} finally {
  await context.close();
  if (!capture) await fs.rm(state.profile, { recursive: true, force: true });
}
