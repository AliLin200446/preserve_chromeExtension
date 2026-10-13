# preserve_chromeExtension

PRESERVE — Phase 04: FLORA Canvas Bridge

Optional FLORA connection is now available inside the Notebook. See [FLORA.md](./FLORA.md) for setup, official endpoints, credential handling, added permissions, mocked test coverage, and live-test limitations. The local workflow remains available without connecting.

**A node-based creative workflow with an artist's notebook inside every stage.** Keep what works. Change only what needs to change.

This extends the existing local-first Chrome extension. The React/TypeScript architecture, domain repository, additively migrated Dexie schema, immutable snapshots, image Blobs, and Manifest V3 side-panel behavior remain intact. There are no new runtime dependencies or backend services. The optional FLORA bridge adds session credential storage and narrowly scoped optional host permissions; it never starts generation.

## Rebuild and reload

Requires Chrome 116 or newer and Node.js 22.12+ for development.

1. Run `npm ci` and `npm run build` in this project.
2. For an existing installation, open **Chrome → Extensions** and click **Reload** on PRESERVE. Keep using the same unpacked directory and browser profile; do not uninstall the extension.
3. For a first installation: **Chrome → Extensions → Developer Mode → Load unpacked → Select dist/**.
4. Click the PRESERVE toolbar action to open the notebook alongside your creative tool.

The supplied `dist/` includes the production manifest, background worker, side-panel HTML, and local assets. No development server, network connection, accounts, or API keys are needed after installation.

## Projects → Workflow → Notebook

- **Projects** keeps the existing project covers, objectives, and switching controls.
- **Workflow** opens an interactive canvas with a simple vertical arrangement. **List** keeps the compact vertical reading view for narrow side panels. Each clickable card shows only the stage number and title, a large image, and a compact status/iteration line. A kept output takes preview priority; otherwise the latest uploaded iteration is shown. Exact reference relationships remain available in the notebook’s expandable lineage details. A new image-less draft never erases the preceding uploaded preview.
- **Notebook** opens the selected stage's **Approved Reference → Current Iteration → Compare & Annotate → Revision Direction → Retry / Keep → History & details**. The same reference contracts, prompt compiler, contact sheet, comparison, and retry actions remain available. Reference requirements are separated into Keep, Change, Adapt, and Ignore. **Version history** in the notebook toolbar opens the retained project archive and restore actions.

Stage actions on the map support rename, move up/down, add after, and confirmed deletion. The ellipsis menu beside the notebook title retains the existing management actions. Duplication is not exposed because there is no safe duplication operation in the existing domain service.

## Visual review and recovery

Open a failed iteration in Stage 03 and choose **Compare with Reference**. The viewer loads its exact stored checkpoint and output, with independent proportional views by default. Toggle is the narrow-panel default; the extension-owned **Open Review Workspace ↗** starts side by side. Pan, zoom, fit, and keyboard controls work in both. Link comparable compositions explicitly to enable the before/after slider; no image registration is performed.

Choose **Place pin**, click the image (or use **Add pin at center**), select **Logo / Typography**, write “The logo changed.”, and save. Saved pins can be edited or removed, survive reopening, and appear live in either view. Choose an earlier image version to inspect its retained pins.

Write the next direction and choose **Try Again from Approved Reference**. This appends a draft with the same approved source, inherited editable prompt/contract, and a frozen snapshot of the failed iteration’s report and annotations. Review the brief before using **Copy Retry Prompt** or **Copy Full Retry Brief**. Generate manually in Krea, upload the result in the Notebook, compare against the same source, then keep it. Earlier images, decisions, and annotations remain available.

The contract editor groups Keep, Change, Adapt, and Ignore. Contact-sheet entries expose annotation counts, source/iteration comparison, decisions, and retry actions. Review direction is saved on blur; pins require an explicit save. Unsaved pin edits block silent navigation.

### Review components and storage

- `src/ReferenceReview.tsx`: exact source inspection, comparison modes, editable pins, retry preview and creation; reused in both views.
- `src/ReviewImage.tsx`: fitted proportional image planes, pan/zoom, normalized pin placement, keyboard navigation, and Blob URL cleanup.
- `src/review.tsx` / `review.html`: third Vite entry on the extension’s existing origin, sharing Dexie and selection settings.
- `src/thumbnails.ts`: lazy in-memory thumbnail generation for visual overviews; original Blobs remain intact.
- `src/domain.ts`: deterministic recovery compiler, immutable retry context, and transactional annotation/image-version repository operations.

`imageVersions` stores an archived output Blob keyed by iteration ID plus SHA-256, with iteration/project indexes. `annotations` stores numbered pin data (normalized x/y, category, note, timestamps) indexed by iteration/project/image version. Numbering is derived from creation order. Opening review archives an output only once per distinct image; replacing a draft image never moves old pins to the replacement. Review can therefore increase local storage use. Nothing is written to localStorage.

`Attempt.revisionContext` and `revisionDirection` are optional additive fields. Retry context cannot be overwritten after creation. Historical attempts and checkpoints remain unchanged; annotations are independent user records. Existing settings hold shared selection and `reviewDirection:<attemptId>`. View mode, camera, and alignment acknowledgement are session-only.

Version 2 adds the two stores without modifying any of the five existing stores or image bytes. Both a real v1 migration unit test and a persistent Chromium before/after record-and-Blob-hash audit passed. No data reset or synthetic reference inference is used.

`npm run test:phase3` tests the full stored-reference → failed image → pin → shared workspace → retry → clipboard → upload → approval flow, image identity, immutable history, browser restart, and widths 320/360/480px. Ten review domain tests cover source resolution, coordinates, annotation persistence, image replacement, retry compilation/provenance, missing data, migration, immutable retry context, and nested transaction safety.

Review is manual: it does not detect errors, align compositions automatically, generate images, or interact with Krea. Stale annotation saves and removals are rejected transactionally; pending edits remain in the editor for manual reconciliation. Collaborative merging is not implemented.

## Full canvas

**Open Canvas ↗** opens a real `chrome-extension://…/canvas.html` page sharing the extension's IndexedDB origin. It is a second Vite entry, not a website or a screenshot. Use:

- Drag the background to pan; scroll to zoom.
- Zoom buttons and **Fit to view** for overview.
- Focus the canvas and use arrow keys to pan, +/− to zoom, or Home to fit.
- Select a node or use the accessible stage selector, to inspect its iterations; double-click a node to open its Notebook. **Back to workflow** returns to the same selected stage.

Drag a node’s grip to move it; focused grips also support arrow-key nudges. Positions persist in `Stage.visualPosition` independently of stage order and references. Touch supports background pan, grip dragging, and two-finger pinch zoom.

Connect an approved output handle to another stage’s input by dragging, or by tapping/clicking the output and then the input. Keyboard users can activate both handles with Enter. A connection **creates a new draft** with that exact approved checkpoint; it never rewires an existing iteration. References must belong to the same project. Unapproved outputs cannot supply connections.

The existing SVG/HTML renderer has been extended rather than introducing a second graph engine. The stage inspector shows branch parents, decision-note indicators, the exact source image/iteration, and downstream iterations using a selected approved image. Camera changes do not write domain records.

### Connection semantics

- **Dashed edges:** sorted workflow stage order. They do not imply reference inheritance.
- **Solid sage edges:** actual stored `Attempt.sourceCheckpointId` references to `Checkpoint` records. Several iterations using one checkpoint are grouped into a branch. Historical checkpoints remain valid sources even when a newer output is approved.
- **Notebook reference branches:** the selected iteration's exact checkpoint is emphasized. Explicit branch links come from `parentIterationId`, with `previousAttemptId` as the backward-compatible fallback; sharing a checkpoint alone does not create a retry-parent relationship.

A rejected image is never promoted to an approved output. Missing references render as unavailable, with no invented graph edge. Empty stages display an unresolved output. Ordered stages and iterations remain separate concepts.

### Shared selection and unsaved work

The existing settings store holds `activeWorkflow`, `activeStage:<workflowId>`, and `activeAttempt:<stageId>`. Live Dexie queries are the saved selection source for both views and tabs. View mode lives in each page's URL fragment. Selection and camera movement do not change checkpoint relationships.

An unsaved editor temporarily stays on its current record if another tab changes selection. A visible notice offers **Save & follow selection** or **Keep working here**; it never silently discards edits. Draft conflict merging between concurrent editors remains a future improvement.

## Try the creative process

1. Create a project, or choose **Explore a sample notebook** for the fictional AURA campaign with labeled local illustrations. These images are not model outputs.
2. Start a **New iteration**. Use a kept reference from a previous chapter, choose a specific approved reference, or start with an original image.
3. Open a stage node. In **Reference**, read what to Keep, Change, Adapt, and Ignore. Expand **Edit preservation requirements** for all four underlying constraint modes and custom attributes.
4. Under **Iterations → Direction & prompts**, **Write direction** in your own words. This edits the existing Additional notes field. **Edit details** exposes all nine structured fields. **View structured prompt** and **Copy prompt** use the original deterministic compiler; no AI rewriting is performed.
5. Upload a PNG, JPEG, or WebP up to 15 MB. **Keep this version** saves the draft and approves it as the chapter's current reference. To change requirements after approval, **Revise this kept version** creates an independently editable copy with the same image.
6. If an output needs work, **What didn't work?** opens the revision form. Select issues and add a note. The image stays visible in the contact sheet.
7. **Try again from approved reference** creates a draft tied to the exact same approved source and the previous rejected iteration, preserving prompt and contract snapshots. **Edit next direction** exposes the editable deterministic retry brief.
8. Review versions through **Version history**, or **Try again from this version** on a kept image to restore its direction in a new iteration.

Changes require **Save notes**, **Keep this version**, or **Save revision note**. The save bar appears only for unsaved work and has reserved scroll space. Switching projects, chapters, or iterations asks before discarding unsaved edits. Save explicitly before closing Chrome; browser shutdown prompts can be suppressed.

## Branch, return, compare

**Branch this iteration** creates an editable child of any selected iteration and keeps every earlier result. **Return to this checkpoint** in the reference section creates a new iteration in the current stage using that exact approved image; the canvas inspector can also target another stage. The parent prompt is retained, checkpoint preservation requirements are restored, and failed output is never copied as an approved reference. New branches leave existing approvals and downstream work valid.

**Compare images** accepts any two iterations in the same stage. Use **Side by side** or **Before / after**, the wipe slider, **Fullscreen inspection**, shared zoom buttons, and drag either image to pan both. Quick **Keep** and **Reject** act on drafts; **Revise** appends a child instead of changing historical decisions. A missing output is explicitly shown as a placeholder.

**Notes on this image** is the existing optional decision note, stored with the iteration. Canvas nodes show only a small note indicator. **Known failure points** can be edited with preservation requirements and is inherited with the approved contract. These are creative instructions, not consistency guarantees.

## Data compatibility

The upgrade is additive: `Stage.visualPosition`, `Attempt.parentIterationId`, and `ReferenceContract.knownFailurePoints` are optional fields supported by the existing object stores. Existing records read without rewriting: absent positions use the default vertical layout; legacy parent links fall back to `previousAttemptId`. No destructive migration, schema reset, record renaming, or database replacement is performed. The database remains `preserve`; Dexie schema version **2** adds two stores without rewriting existing records. New labels map to existing values:

| Notebook language              | Existing domain value              |
| ------------------------------ | ---------------------------------- |
| Project / Chapter / Iteration  | Workflow / Stage / Attempt         |
| Kept                           | APPROVED                           |
| For revision                   | REJECTED                           |
| In the making                  | DRAFT                              |
| Direction notes                | PromptSchema                       |
| Revision note                  | FailureReport                      |
| Keep / Change / Adapt / Ignore | PRESERVE / CHANGE / ADAPT / IGNORE |

All seven human-readable revision choices map to the original failure category strings in `src/presentation.ts`. Stage and iteration preferences use keys in the existing settings store; no additional settings store is needed. Cover images and last-edited dates are derived from existing checkpoint/attempt records.

The upgrade test was run against a persistent Chromium profile populated by the preceding artist-notebook build, then reopened with the redesigned build. It compares all domain records and SHA-256 hashes of every image Blob. All records and image bytes were unchanged.

## Development and validation

Use Node.js 22.12+ (validated with Node 25) and npm.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:smoke
npm run test:phase2
npm run test:phase3
```

The Vite development page is useful for UI development, but uses a separate IndexedDB origin from the installed extension. Load `dist/` to test actual extension behavior. No development server is needed after installation. For a before/after upgrade audit, run `node tests/compatibility.mjs --capture` with the preceding build, rebuild the notebook in the same `dist/` directory, then run `node tests/compatibility.mjs`. The audit uses a temporary browser profile, not your personal profile.

- All 56 Vitest tests pass: the 21 existing domain tests remain unchanged and cover workflow creation, stage ordering, drafts, approval, rejection, retries, immutable prompt and contract snapshots, reference selection, exports, restore, missing references, and invalid cross-workflow references.
- Two Phase 02 repository tests verify the complete approval/rejection/checkpoint-return sequence across reopen, immutable branch parents, protected lineage identity, and position-only writes.
- Ten additional graph tests cover stage-order projection, non-adjacent explicit sources, retained approvals, historical references, branching, missing sources, selected-iteration highlighting, same-stage restores, and nonmutation.
- The Playwright smoke test loads the real built MV3 extension in a temporary Chromium profile, verifies its background service worker and toolbar-side-panel configuration, then exercises its entry page. It opens the actual canvas tab and checks graph edges, cross-tab selection, map/notebook navigation, pointer/keyboard pan, wheel/button zoom, fit-to-view, and stage-context-menu insertion/reordering. It also covers demo creation, saved data after reload and a browser restart, empty workflow creation, stage reordering, invalid-file validation, prompt editing, uploads, approval, failure/retry, comparison, lineage, restore, offline operation, and widths of 320, 360, 375, 480, and 1440 pixels, plus an effective 180-pixel layout for zoom/reflow. It does not automate Chrome's native side-panel toolbar itself.
- `npm run test:phase2` creates a real four-stage project, approves Stage 01/02, rejects Stage 03, returns to Stage 02’s checkpoint, creates and compares a second Stage 03 output, and verifies immutable data after reload and browser restart. It also exercises handle connections, position-only movement, touch pan/pinch, and double-click navigation.
- Screenshots are generated in `artifacts/`: workflow maps at 320/360/375/480/1440px, the full canvas, project cover, notebook layouts, and reference/contact-sheet viewport captures.

## Architecture

- `src/domain.ts`: strict domain types, deterministic prompt/brief exports, image validation, Dexie schema, and transactional repository operations.
- `src/main.tsx`: shared project/stage/iteration selection, Projects/Workflow/Notebook routing, retained notebook actions, and live queries.
- `src/graph.ts`: pure read-only projections of stored stage order, checkpoint dependencies, and retry lineage.
- `src/WorkflowMap.tsx`: compact vertical nodes and working stage menus.
- `src/WorkflowCanvas.tsx`: interactive canvas, saved node positions, pointer/touch camera controls, connection handles, iteration inspector, and keyboard navigation.
- `src/Comparison.tsx`: side-by-side/slider modes, fullscreen inspection, synchronized image pan/zoom, and Keep/Reject/Revise actions.
- `src/Lineage.tsx`: actual approved-reference branches and explicit retry links in the notebook.
- `src/NotebookPieces.tsx`: reused Blob-preview lifecycle plus shared upload, modal, reference-summary, contract-editor, and progressively disclosed direction components.
- `src/presentation.ts`: human-language mappings over unchanged domain statuses and failure categories.
- `src/demo.ts`: explicitly optional sample data and local Canvas illustrations.
- `src/style.css` and `src/workflow.css`: one paper/ink/sage/terracotta palette across the notebook and dotted canvas, responsive nodes/contact sheets, local font fallbacks, focus states, and reduced-motion support. No fonts or images are fetched remotely.
- `public/manifest.json`: Manifest V3; `sidePanel`, session `storage`, and narrowly scoped optional FLORA/CDN host permissions.
- `src/background.ts`: enables opening the side panel when the toolbar action is clicked, following the [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

React state holds navigation, form edits, comparison choices, dialogs, and notifications. Dexie holds persisted domain entities and the active workflow preference. No large media or domain records are stored in localStorage. Blob object URLs are allocated by the preview component and revoked when the image changes or component unmounts.

The repository remains the boundary for platform imports. The optional FLORA adapter uses authorized API requests and narrow host permissions; there is no content script, page scraping, cookie collection, injection, or generation automation.

## IndexedDB schema and versioning

Database: `preserve`, Dexie schema version **2** (native IndexedDB version 20).

| Store       | Primary key | Secondary indexes                                          | Contents                                                                                                                                                           |
| ----------- | ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| workflows   | id          | createdAt                                                  | Name, description, platform, creative objective, timestamp, optional sample flag                                                                                   |
| stages      | id          | workflowId, order                                          | Ordered stages, manual stage status, currentCheckpointId, optional visualPosition                                                                                  |
| attempts    | id          | stageId, workflowId, sourceCheckpointId, previousAttemptId | Draft/approved/rejected output Blob, prompt and contract snapshots, platform, notes, timestamps, failure reports, editable retry brief, optional parentIterationId |
| checkpoints | id          | attemptId, stageId, workflowId                             | Immutable approved output and prompt/contract snapshots, platform, notes, approval time                                                                            |
| settings    | key         | —                                                          | Last active workflow ID                                                                                                                                            |

Stable IDs come from `crypto.randomUUID()`. Relationships are IDs, not inferred from visible order. Prompt and contract snapshots have version numbers that advance when inherited into a new attempt; edits within a draft retain that draft's version. A checkpoint's approval time and identity distinguish historical approvals independently of those revision numbers.

Approval runs in one transaction: insert the checkpoint, mark the attempt approved, and update the stage's current checkpoint. Prior approvals remain. Approved and rejected attempts cannot be edited through the repository; reuse produces a separate draft. A retry points to the approved source with `sourceCheckpointId` and the preceding failure with `previousAttemptId`.

**Restore means create a new editable draft from an earlier checkpoint.** It inherits the prompt and contract and links the source, with no generated output attached. It neither deletes later history nor changes the current checkpoint until the new draft is approved. A stage's objective is applied when creating an attempt from a different stage; restoring within the same stage retains the saved objective. The original reference image remains available in the source preview.

Stage deletion requires explicit UI confirmation and atomically removes that stage's attempts and checkpoints. References from other stages remain stored and render as unavailable. Retrying from a missing source produces an actionable error; it never silently chooses a different reference.

The v1 declaration remains unchanged. Version 2 adds only `imageVersions` and `annotations`; no upgrade callback or historical backfill is needed. Future schema changes must append a tested version. Do not edit existing schema versions or reset user data during an upgrade.

## Known limitations

- Canvas handles create new drafts from approved checkpoints. They do not execute generations, rewrite historical dependencies, or reorder stages. Stage order remains a separate contextual action. Camera pan/zoom and comparison inspection settings are session-only; node positions, branch parents, references, prompts, decisions, notes, and preservation instructions persist.

- Preservation requirements are creative instructions; they cannot enforce model behavior. Failures are identified manually.
- Only PNG/JPEG/WebP outputs are currently accepted. Video stages can store a representative frame and written notes, not video files.
- Prompts and briefs are assembled from templates and user fields. No LLM rewriting or automatic visual evaluation is performed.
- Saved data is local to one browser profile and extension origin. Uninstalling the extension or clearing its storage can remove it. Backup/export and recovery from browser quota exhaustion are not yet provided; storage errors are surfaced without claiming a successful save.
- Browser unload prompts may be suppressed in some shutdown situations. Draft saving is explicit.
- Source-less failed attempts need a new attempt with an explicitly selected approved reference before checkpoint-based retry is possible.
- Comparison shows images, status, notes, prompt, and contract; it has no pixel-diff or automated quality scoring.
- No cloud sync or automatic generation; FLORA is an optional authenticated integration.

## Future improvements

1. Portable project export/import with image assets and verified lineage.
2. Safe draft autosave with revision recovery and multi-panel conflict detection.
3. Video output previews and time-based failure annotations.
4. Pixel-difference inspection and optional image registration.
5. Contract revision history, prompt library, and stage objective templates.
6. Storage usage controls and archive management.
7. Explicitly authorized platform adapters behind the repository boundary.

### Editorial visual review

`node tests/visual-review.mjs` captures Workflow, Notebook sections, and contextual menus at 375px and 1440px using the built extension in an isolated profile. It checks the shared paper background, six-section hierarchy, and horizontal overflow. Viewport captures are saved as `artifacts/refined-*.png`.
