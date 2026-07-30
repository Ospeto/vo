import { describe, expect, test } from "bun:test";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { SafePasteService, type ClipboardSnapshot, type TargetIdentity } from "../../services/safe-paste.js";
import { captureActiveSelection, SelectionOwnershipManager } from "../../services/selection-service.js";
import { handleRecordingError } from "../../services/recording-error.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

const target: TargetIdentity = { bundleId: "com.editor", appName: "Editor", pid: 1, windowId: 1 };

function cloneSnapshot(snapshot: ClipboardSnapshot): ClipboardSnapshot {
  return {
    ...snapshot,
    formats: snapshot.formats.map(({ format, data }) => ({ format, data: Buffer.from(data) })),
  };
}

function makeClipboard(initial: ClipboardSnapshot) {
  let current = cloneSnapshot(initial);
  return {
    readText: () => current.text ?? "",
    writeText: (text: string) => { current = { text, formats: [] }; },
    snapshot: () => cloneSnapshot(current),
    restore: (snapshot: ClipboardSnapshot) => { current = cloneSnapshot(snapshot); },
    set: (snapshot: ClipboardSnapshot) => { current = cloneSnapshot(snapshot); },
    get: () => cloneSnapshot(current),
    preservesCustomFormats: true,
  };
}

function ownership(sequenceId: number, previousClipboard: ClipboardSnapshot, ownershipSnapshot: ClipboardSnapshot): Parameters<SelectionOwnershipManager["setOwnership"]>[0] {
  return { sequenceId, previousClipboard, hasSelection: true, selectedText: ownershipSnapshot.text ?? "", ownershipSnapshot };
}

describe("clipboard ordering regressions", () => {
  test("keeps the sequence high-water mark after ownership is cleared", () => {
    const manager = new SelectionOwnershipManager();
    manager.setOwnership(ownership(2, { text: "before-2", formats: [] }, { text: "selection-2", formats: [] }));
    manager.clearOwnership(2);
    manager.setOwnership(ownership(1, { text: "before-1", formats: [] }, { text: "selection-1", formats: [] }));

    expect(manager.getOwnership()).toBeNull();
  });

  test("does not restore over a user copy when selection capture is aborted", async () => {
    const clipboard = makeClipboard({ text: "before", html: "<b>before</b>", formats: [] });
    const controller = new AbortController();
    const pending = captureActiveSelection(500, { signal: controller.signal, port: clipboard });
    clipboard.set({ text: "user-copy", html: "<b>user</b>", formats: [] });
    controller.abort();

    await pending;
    expect(clipboard.get()).toEqual({ text: "user-copy", html: "<b>user</b>", formats: [] });
  });

  test("does not let an aborted older capture restore over a newer capture", async () => {
    const clipboard = makeClipboard({ text: "before-1", formats: [] });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = captureActiveSelection(500, { signal: firstController.signal, port: clipboard });
    const second = captureActiveSelection(500, { signal: secondController.signal, port: clipboard });
    clipboard.set({ text: "sequence-2-selection", html: "<b>newer</b>", formats: [] });

    firstController.abort();
    await first;
    expect(clipboard.get()).toEqual({ text: "sequence-2-selection", html: "<b>newer</b>", formats: [] });
    secondController.abort();
    await second;
  });

  test("skips stale SafePaste restoration after a newer clipboard change during the hold", async () => {
    const clipboard = makeClipboard({ text: "sequence-1-selection", formats: [] });
    let current = true;
    let releaseHold!: () => void;
    let holdEntered!: () => void;
    const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
    const entered = new Promise<void>((resolve) => { holdEntered = resolve; });
    const safePaste = new SafePasteService(
      () => target,
      async () => {},
      clipboard,
      async () => {},
      undefined,
      async () => { holdEntered(); await hold; },
    );
    safePaste.captureTarget();

    const pending = safePaste.paste("sequence-1-dictation", () => current);
    await entered;
    current = false;
    clipboard.set({ text: "sequence-2-user-copy", html: "<b>newer</b>", formats: [] });
    releaseHold();
    await pending;

    expect(clipboard.get()).toEqual({ text: "sequence-2-user-copy", html: "<b>newer</b>", formats: [] });
  });

  test("production paste composition restores the original rich clipboard", async () => {
    const original: ClipboardSnapshot = {
      text: "original",
      html: "<b>original</b>",
      rtf: "{\\rtf1 original}",
      formats: [{ format: "com.vendor", data: Buffer.from("original-binary") }],
    };
    const clipboard = makeClipboard(original);
    const manager = new SelectionOwnershipManager();
    clipboard.set({ text: "selection", html: "<i>selection</i>", formats: [] });
    manager.setOwnership(ownership(1, original, clipboard.snapshot()));

    const safePaste = new SafePasteService(() => target, async () => {}, clipboard, async () => {}, undefined, async () => {});
    safePaste.captureTarget();
    const coordinator = new PasteCoordinator((text, isCurrent, beforeWrite) => safePaste.paste(text, isCurrent, beforeWrite));
    const result = await coordinator.pasteText("dictation", 1, () => true, () => manager.restoreCapturedSelection(1, clipboard));

    expect(result).toEqual({ status: "submitted" });
    expect(manager.getOwnership()).toBeNull();
    expect(clipboard.get()).toEqual(original);
  });

  test("rejects null recording-error IPC payloads without throwing", () => {
    const lifecycle = new RecordingLifecycle();
    expect(handleRecordingError(null, lifecycle, () => {}, () => {}, () => {})).toBe(false);
  });
});
