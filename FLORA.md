# FLORA Canvas Bridge — Phase 04

PRESERVE 0.6.0 adds an optional official-API bridge inside Notebook → Compare & Annotate → Connected Canvas. Existing local projects, approvals, comparisons, annotations, retries, and canvas controls remain available without a connection.

## Configure and use

1. Run `npm ci && npm run build`. In Chrome Extensions, reload the existing unpacked `dist/` directory. Keep the same extension origin and profile to retain IndexedDB data.
2. In FLORA, open Settings → API Keys. Create a key scoped to your test workspace with **read** permission. Add **write** only if you want confirmed node preparation. Billing permission is not required by this bridge.
3. Open a local PRESERVE project/stage, expand **Connected Canvas → Connection & privacy**, paste the key into the password field, and select **Connect FLORA**. Grant the optional FLORA origin permission. Do not paste credentials into chat or project notes.
4. Choose a workspace and project. Use **Project visibility** and **Refresh projects** to switch between your projects and shared workspace canvases; **More projects** handles pagination.
5. **Load canvas**, search actual API nodes, and choose one. **Load selected image** requests access to its download host and loads/validates its actual PNG, JPEG, or WebP output (15 MB maximum). Text output is readable; video has an explicit preview. Unsupported fields/types are labeled, not synthesized.
6. Choose the local project, stage, and new iteration or empty draft. Optionally select a specific PRESERVE approved reference. Choose **Save as Draft** or **Approve as Checkpoint**, then save. Selecting approval and clicking **Save as Checkpoint** is an explicit approval; imports otherwise remain drafts.
7. Review the saved image in the existing Notebook/comparison flow. Its original FLORA prompt, model, IDs, input/output snapshot, edges, and import time remain available under **Imported from FLORA**.
8. Choose a target FLORA project and select **Prepare Retry on Canvas**. Review the target, approved reference preview, prompt, proposed operation, and cost explanation. The confirmation checkbox enables **Confirm · Create FLORA node**. It creates one new image node and reference edge, without calling a generation/run endpoint.

When the approved image was not imported from the same FLORA project, its node is unavailable, or its current remote bytes differ from the approved local Blob, the panel offers **Manual handoff**. Copy the prompt and upload the approved reference yourself in FLORA. The bridge does not upload local files or silently substitute another reference. A source can still change between verification and the server applying a changeset; the API offers no atomic image-content precondition for this operation, so review the prepared node in FLORA before generating.

## Official API surface

API base: `https://app.flora.ai/api/v1`. These are the only operations exposed by the service worker:

| Operation                                                              | Purpose                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `GET /workspaces`                                                      | Validate authentication and list key-accessible workspaces      |
| `GET /projects?workspace_id=…&limit=100&cursor=…&visibility=workspace` | Project listing; cursor and visibility are optional             |
| `GET /workspaces/{workspaceId}/projects/{projectId}/canvas/definition` | Canonical nodes, positions, edges, opaque inputs and outputs    |
| `GET /workspaces/{workspaceId}/projects/{projectId}/graph`             | Typed node prompt/model/output metadata, joined by exact UUID   |
| `GET /projects/{projectId}/nodes?limit=100&cursor=…`                   | Asset IDs/output URLs, paginated                                |
| `GET /assets/{assetId}`                                                | Accessible, ready asset URL and media type                      |
| `POST /workspaces/{workspaceId}/projects/{projectId}/canvas/changeset` | Confirmed addition of a new image node and image-reference edge |

The changeset contains only `add` and `connect`. It never updates/removes existing nodes or calls `/generate`, node runs, action runs, or technique runs. Each prepared preview has a stable `Idempotency-Key` for retries. Success requires the documented response to acknowledge both the node and edge. Network uncertainty or conflicts are surfaced; no automatic write retry is performed.

Sources inspected during implementation: [authentication](https://developer.flora.ai/platform/authentication/), [workspaces](https://developer.flora.ai/reference/operations/listworkspaces/), [projects](https://developer.flora.ai/reference/operations/listprojects/), [canvas definition](https://developer.flora.ai/reference/operations/getprojectcanvasdefinition/), [graph](https://developer.flora.ai/reference/operations/getprojectgraph/), [canvas nodes](https://developer.flora.ai/reference/operations/listcanvasnodes/), [assets](https://developer.flora.ai/reference/operations/getasset/), [changesets](https://developer.flora.ai/reference/operations/applycanvaschangeset/), [generation](https://developer.flora.ai/reference/operations/startgeneration/), and [actions](https://developer.flora.ai/reference/operations/createcanvasaction/).

The documented REST authentication uses bearer API keys. FLORA also documents OAuth for MCP clients; this extension does not invent a REST OAuth client flow or reuse browser session tokens. No documented browser-selected-node event was found in the inspected public surface. **Choose Node from Canvas** is a snapshot picker, not live selection synchronization.

## Architecture and data

- `src/platforms/types.ts`: typed adapter, capabilities, normalized canvas, external provenance, and handoff models. Future adapters can implement this interface; Krea, Runway, and OpenArt currently have no integration.
- `src/platforms/flora.ts`: strict canonical parsing, UUID-based enrichment, pagination, transport adapter, bounded asset download, and changeset construction.
- `src/platforms/service.ts`: allowlisted official API operations, credential-vault boundary, safe errors, timeout, confirmation and idempotency handling. No arbitrary-URL credential proxy.
- `src/background.ts`: module service worker, session-only credential vault, extension-origin sender validation, existing toolbar side-panel behavior.
- `src/platforms/import.ts`: atomic local import/approval, duplicate protection, provenance and explicit lineage, deterministic handoff preparation.
- `src/ConnectedCanvas.tsx`: compact progressive UI, selected-image preview, destination decision, handoff preview, shared connection status, and disconnect.

Dexie stays at **v2**. Optional `externalSource` fields on attempts and checkpoints require no store/index changes, migrations, or backfill. Approvals copy provenance into the immutable checkpoint. Imported provenance is an immutable snapshot, including a SHA-256 of the original imported image; replacing a draft's image does not claim the new image is the original FLORA asset. Duplicate checks use workspace/project/node/image hash within the destination stage. Transactions prevent concurrent duplicate imports and reject changed or nonempty draft destinations.

FLORA canvas edges and opaque generation-input data remain separate external provenance. Internal `sourceCheckpointId` is set only by direct user selection (or retained on an existing empty draft). Stage order, retry parents, platform edges, and approved checkpoint lineage are not conflated. Generation/provider identifiers absent from the documented typed response are not guessed; original input/output fields remain inspectable.

## Credentials, permissions and retention

The new required permission is `storage`. Credentials use `chrome.storage.session` with `TRUSTED_CONTEXTS`, not local/sync storage or IndexedDB. The password field is cleared during connection. The credential is sent only to the documented FLORA API origin, never to an asset CDN, webpage, analytics, or imported record. REST and asset fetches omit cookies and reject redirects. There are no content scripts, cookie access, traffic interception, broad tab permission, or `<all_urls>` permission.

Optional host permissions are `https://app.flora.ai/*`, `https://ik.imagekit.io/*`, `https://storage.googleapis.com/*`, and `https://*.s3.amazonaws.com/*`. They are requested when the user connects or loads an asset. Unknown hosts require manual download/import. Asset downloads are bounded to 15 MB and validated as decodable images. The active tab's FLORA origin can be detected after host access is granted; unrelated page content is not read.

**Disconnect FLORA** deletes the session credential and clears remote UI state, then removes the declared optional host permissions. Already imported images and provenance remain in IndexedDB. Browser restart also clears the key. Revoking the key itself must be done in FLORA Settings. Uninstalling or clearing extension storage can remove local creative work.

## Validation and limits

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:smoke`, `npm run test:phase2`, `npm run test:phase3`, and `npm run test:phase4`.

Phase 04 tests use **mocked API responses**, never fake production connection data. Unit tests cover auth/errors/disconnect, documented routes, parsing and ID joins, bounded downloads, explicit write confirmation/acknowledgement, draft imports, approval, duplicates, unsupported types, preserved lineage, and compatibility with the current database. The Chromium mock test exercises the built extension and service-worker boundary, real local Blob import/checkpoint creation, credential separation, confirmation gating, no generation requests, retained local data after disconnect, and 320/360/480/1440px layouts. Native optional-host dialogs are stubbed in this test.

**No real authenticated FLORA smoke test has run:** no user-authorized credential/test project was supplied. Configure a disposable test project using the steps above before treating account-specific permissions, CDN behavior, or write-back as live-verified. This bridge uses the actual documented endpoints; mocked tests do not establish production compatibility.

Limits: image checkpoint imports only; explicit video preview/text inspection; no browser-selection sync, automatic generation, local-reference upload, cloud synchronization, automatic polling, or browser automation fallback. Default FLORA image-model settings are used for a prepared node; choose and review the desired model/settings in FLORA before manually generating. Asset and graph schemas may change; unsupported shapes fail visibly.
