import { createFloraService } from "./platforms/service";
import { BridgeError, record } from "./platforms/flora";
const ready = chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
const service = createFloraService({
  async get() {
    await ready;
    return (await chrome.storage.session.get("floraCredential"))
      .floraCredential;
  },
  async set(key) {
    await ready;
    await chrome.storage.session.set({ floraCredential: key });
  },
  async clear() {
    await ready;
    await chrome.storage.session.remove("floraCredential");
  },
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.bridge !== "flora") return;
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(""))
  ) {
    respond({ ok: false, error: "Untrusted bridge caller." });
    return;
  }
  void service(String(message.op), record(message.args))
    .then((value) => respond({ ok: true, value }))
    .catch((e) =>
      respond({
        ok: false,
        state: e instanceof BridgeError ? e.state : "Connection error",
        error:
          e instanceof BridgeError
            ? e.message
            : "The bridge operation could not be completed.",
      }),
    );
  return true;
});
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
