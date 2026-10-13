import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "preserve-visual-"));
const extension = path.resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/index.html`,
  );
  await page.getByRole("button", { name: "Explore a sample notebook" }).click();
  await page.locator(".canvas-node").first().waitFor();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByLabel("Select canvas stage", { exact: true })
      .selectOption({ label: "3 / Model + Product Ad Shot" });
    await expect(page.locator('main[aria-busy="false"]')).toBeVisible();
    await page
      .locator(".canvas-node img")
      .evaluateAll((imgs) => Promise.all(imgs.map((img) => img.decode())));
    await page.screenshot({
      path: "artifacts/phase2-sample-canvas-" + width + ".png",
    });
  }
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.locator(".workflow-node").first().waitFor();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator("main")).toHaveCSS(
      "background-color",
      "rgb(245, 242, 233)",
    );
    await expect(page.locator(".node-input")).toHaveCount(0);
    await page.screenshot({ path: `artifacts/refined-workflow-${width}.png` });
    await page.locator(".node-menu summary").first().click();
    await expect(
      page.getByRole("button", { name: "Rename stage", exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({ path: `artifacts/refined-menu-${width}.png` });
    await page.locator(".node-menu summary").first().click();
    await page
      .getByRole("button", {
        name: "Open stage 03: Model + Product Ad Shot",
        exact: true,
      })
      .click();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(
      page.locator(".chapter-section > .section-title h2"),
    ).toHaveText([
      "Approved Reference",
      "Current Iteration",
      "Compare & Annotate",
      "Revision Direction",
      "Retry / Keep",
      "History & details",
    ]);
    await page.locator(".reference-section img").waitFor();
    await page
      .locator(".reference-section img")
      .evaluate((img) => img.decode());
    await page.screenshot({ path: `artifacts/refined-notebook-${width}.png` });
    for (const id of [
      "current-iteration",
      "compare-reference",
      "revision-direction",
      "iterations",
      "decision",
      "next-step",
    ]) {
      await page
        .locator("#" + id)
        .evaluate((el) =>
          el.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      await page.screenshot({ path: `artifacts/refined-${id}-${width}.png` });
    }
    await page.getByLabel("Stage options", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Rename chapter", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/refined-notebook-menu-${width}.png`,
    });
    await page.getByLabel("Stage options", { exact: true }).click();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Horizontal overflow");
  }
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page
    .getByRole("button", { name: "Open stage 04: Model Ad Video", exact: true })
    .click();
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .locator("#current-iteration")
      .evaluate((el) =>
        el.scrollIntoView({ block: "start", behavior: "instant" }),
      );
    await expect(
      page.getByRole("heading", { name: "A fresh page for this stage" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start the first iteration" })
      .focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.screenshot({
      path: `artifacts/refined-empty-focus-${width}.png`,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Empty notebook horizontal overflow");
  }
  console.log(
    "PASS: mobile/desktop editorial palette, six-section hierarchy, menus, and viewport captures.",
  );
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
}
