import { describe, test, expect, beforeEach } from "bun:test";
import {
  areClipboardSnapshotsEqual,
  SelectionOwnershipManager,
  createElectronClipboardAdapter,
} from "../../services/selection-service.js";
import {
  createClipboardPort,
  SafePasteService,
  type ClipboardAdapter,
  type ClipboardSnapshot,
  type TargetIdentity,
} from "../../services/safe-paste.js";
import { PasteCoordinator } from "../../services/paste-flow.js";
import { RecordingLifecycle } from "../../services/recording-lifecycle.js";

function createMockRichClipboardAdapter(initialText = "Original Clipboard Text") {
  let text = initialText;
  let html = "<p>Original HTML</p>";
  let rtf = "{\\rtf1 Original RTF}";
  let image: any = { isEmpty: () => false, toDataURL: () => "data:image/png;base64,original" };
  const customFormats = new Map<string, Buffer>([["custom/vendor-format", Buffer.from("vendor-binary-123")]]);

  return {
    readText: () => text,
    writeText: (t: string) => {
      text = t;
      html = "";
      rtf = "";
      image = undefined;
      customFormats.clear();
    },
    write: (data: any) => {
      text = data.text ?? "";
      html = data.html ?? "";
      rtf = data.rtf ?? "";
      image = data.image;
    },
    clear: () => {
      text = "";
      html = "";
      rtf = "";
      image = undefined;
      customFormats.clear();
    },
    readHTML: () => html,
    readRTF: () => rtf,
    readImage: () => image,
    availableFormats: () => [
      ...(text ? ["text/plain"] : []),
      ...(html ? ["text/html"] : []),
      ...(rtf ? ["text/rtf"] : []),
      ...(image ? ["image/png"] : []),
      ...Array.from(customFormats.keys()),
    ],
    readBuffer: (fmt: string) => customFormats.get(fmt) || Buffer.alloc(0),
    writeBuffer: (fmt: string, data: Buffer) => {
      customFormats.set(fmt, data);
    },
    writeBufferIsAdditive: true,

    // Test helper to manipulate clipboard state directly
    setDirectState: (newText: string, newHtml?: string, newRtf?: string, newImage?: any, newCustom?: [string, Buffer][]) => {
      text = newText;
      html = newHtml ?? "";
      rtf = newRtf ?? "";
      image = newImage;
      customFormats.clear();
      if (newCustom) {
        for (const [k, v] of newCustom) customFormats.set(k, v);
      }
    },
  };
}

describe("PR-06 Conditional Clipboard Restoration & Ownership Remediation Suite", () => {
  let adapter: ReturnType<typeof createMockRichClipboardAdapter>;
  let port: ReturnType<typeof createClipboardPort>;
  let ownershipManager: SelectionOwnershipManager;

  beforeEach(() => {
    adapter = createMockRichClipboardAdapter();
    port = createClipboardPort(adapter as unknown as ClipboardAdapter<any>);
    ownershipManager = new SelectionOwnershipManager();
  });

  describe("1. Snapshot Equality & Format-Rich Fingerprinting (Plain Text, HTML, RTF, Image, Custom Formats)", () => {
    test("detects matching snapshots across all rich format dimensions", () => {
      const snapA = port.snapshot();
      const snapB = port.snapshot();
      expect(areClipboardSnapshotsEqual(snapA, snapB)).toBe(true);
    });

    test("detects text modifications", () => {
      const snapA = port.snapshot();
      adapter.setDirectState("Modified Text", "<p>Original HTML</p>", "{\\rtf1 Original RTF}");
      const snapB = port.snapshot();
      expect(areClipboardSnapshotsEqual(snapA, snapB)).toBe(false);
    });

    test("detects HTML format modifications", () => {
      const snapA = port.snapshot();
      adapter.setDirectState("Original Clipboard Text", "<p>Modified HTML</p>", "{\\rtf1 Original RTF}");
      const snapB = port.snapshot();
      expect(areClipboardSnapshotsEqual(snapA, snapB)).toBe(false);
    });

    test("detects RTF format modifications", () => {
      const snapA = port.snapshot();
      adapter.setDirectState("Original Clipboard Text", "<p>Original HTML</p>", "{\\rtf1 Modified RTF}");
      const snapB = port.snapshot();
      expect(areClipboardSnapshotsEqual(snapA, snapB)).toBe(false);
    });

    test("detects image format modifications", () => {
      const snapA = port.snapshot();
      adapter.setDirectState(
        "Original Clipboard Text",
        "<p>Original HTML</p>",
        "{\\rtf1 Original RTF}",
        { isEmpty: () => false, toDataURL: () => "data:image/png;base64,different" }
      );
      const snapB = port.snapshot();
      expect(areClipboardSnapshotsEqual(snapA, snapB)).toBe(false);
    });

    test("detects custom buffer format modifications", () => {
      const snapA = port.snapshot();
      adapter.setDirectState(
        "Original Clipboard Text",
        "<p>Original HTML</p>",
        "{\\rtf1 Original RTF}",
        undefined,
        [["custom/vendor-format", Buffer.from("vendor-binary-CHANGED")]]
      );
      const snapB = port.snapshot();
      expect(areClipboardSnapshotsEqual(snapA, snapB)).toBe(false);
    });
  });

  describe("2. Unchanged Selection Clipboard Restoration", () => {
    test("restores rich previous clipboard when selection capture clipboard is unchanged", () => {
      const initialSnapshot = port.snapshot();
      // Selection capture occurs: target app copied "highlighted selection text"
      adapter.writeText("highlighted selection text");
      const ownershipSnapshot = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 101,
        previousClipboard: initialSnapshot,
        hasSelection: true,
        selectedText: "highlighted selection text",
        ownershipSnapshot,
      });

      const restored = ownershipManager.restoreCapturedSelection(101, port);
      expect(restored).toBe(true);
      expect(adapter.readText()).toBe("Original Clipboard Text");
      expect(adapter.readHTML()).toBe("<p>Original HTML</p>");
      expect(adapter.readRTF()).toBe("{\\rtf1 Original RTF}");
      expect(adapter.readBuffer("custom/vendor-format").toString()).toBe("vendor-binary-123");
    });
  });

  describe("3. User Changes Surviving Success, Denial, Cancellation, Error, and Timeout", () => {
    test("user clipboard change survives dictation cancellation", () => {
      const initialSnapshot = port.snapshot();
      adapter.writeText("captured text selection");
      const ownershipSnapshot = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 201,
        previousClipboard: initialSnapshot,
        hasSelection: true,
        selectedText: "captured text selection",
        ownershipSnapshot,
      });

      // User copies new text during dictation
      adapter.writeText("User copied this while speaking");

      // Dictation cancelled
      const restored = ownershipManager.restoreCapturedSelection(201, port);
      expect(restored).toBe(false);
      expect(adapter.readText()).toBe("User copied this while speaking");
    });

    test("user clipboard change survives transcription error", () => {
      const initialSnapshot = port.snapshot();
      adapter.writeText("captured text selection");
      const ownershipSnapshot = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 202,
        previousClipboard: initialSnapshot,
        hasSelection: true,
        selectedText: "captured text selection",
        ownershipSnapshot,
      });

      // User copies new RTF/HTML content during transcription
      adapter.setDirectState("User copied content", "<b>user html</b>");

      // Transcription error triggers restore
      const restored = ownershipManager.restoreCapturedSelection(202, port);
      expect(restored).toBe(false);
      expect(adapter.readText()).toBe("User copied content");
      expect(adapter.readHTML()).toBe("<b>user html</b>");
    });

    test("user clipboard change survives stopping timeout", () => {
      const initialSnapshot = port.snapshot();
      adapter.writeText("captured text selection");
      const ownershipSnapshot = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 203,
        previousClipboard: initialSnapshot,
        hasSelection: true,
        selectedText: "captured text selection",
        ownershipSnapshot,
      });

      // User modifies clipboard with custom binary format
      adapter.setDirectState("User binary copy", undefined, undefined, undefined, [["app/custom", Buffer.from("user-data")]]);

      // Stopping state timeout triggers restore
      const restored = ownershipManager.restoreCapturedSelection(203, port);
      expect(restored).toBe(false);
      expect(adapter.readText()).toBe("User binary copy");
      expect(adapter.readBuffer("app/custom").toString()).toBe("user-data");
    });

    test("user clipboard change survives paste denial", async () => {
      const initialSnapshot = port.snapshot();
      adapter.writeText("captured text selection");
      const ownershipSnapshot = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 204,
        previousClipboard: initialSnapshot,
        hasSelection: true,
        selectedText: "captured text selection",
        ownershipSnapshot,
      });

      // User changes clipboard before paste execution
      adapter.writeText("New user copy before paste");

      // Clear ownership before SafePaste begins
      ownershipManager.clearOwnership(204);

      const targetApp: TargetIdentity = { bundleId: "com.editor", appName: "Editor", pid: 1, windowId: 1 };
      let injected = false;

      const safePaste = new SafePasteService(
        () => targetApp,
        async () => { injected = true; },
        createClipboardPort(adapter as unknown as ClipboardAdapter<any>),
        async () => { throw new Error("target_mismatch"); } // Simulate target reauthorization denial
      );

      const pasteResult = await safePaste.paste("transcribed output");
      expect(pasteResult.ok).toBe(false);

      // Post-paste restoreCapturedSelection runs
      const restored = ownershipManager.restoreCapturedSelection(204, port);
      expect(restored).toBe(false);
      expect(adapter.readText()).toBe("New user copy before paste");
    });
  });

  describe("4. Sequence Isolation", () => {
    test("calling restoreCapturedSelection for old sequence ID does not affect current sequence ownership", () => {
      const snapshot1 = port.snapshot();
      adapter.writeText("Seq 1 selection");
      const ownershipSnap1 = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 301,
        previousClipboard: snapshot1,
        hasSelection: true,
        selectedText: "Seq 1 selection",
        ownershipSnapshot: ownershipSnap1,
      });

      // Sequence 2 starts and takes over selection ownership
      adapter.writeText("Seq 2 selection");
      const ownershipSnap2 = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 302,
        previousClipboard: snapshot1,
        hasSelection: true,
        selectedText: "Seq 2 selection",
        ownershipSnapshot: ownershipSnap2,
      });

      // Delayed callback from Sequence 1 attempts restore
      const restoredSeq1 = ownershipManager.restoreCapturedSelection(301, port);
      expect(restoredSeq1).toBe(false);

      // Sequence 2 ownership remains active and intact
      expect(ownershipManager.getOwnership()?.sequenceId).toBe(302);
      expect(adapter.readText()).toBe("Seq 2 selection");

      // Sequence 2 restores cleanly when finished
      const restoredSeq2 = ownershipManager.restoreCapturedSelection(302, port);
      expect(restoredSeq2).toBe(true);
      expect(adapter.readText()).toBe("Original Clipboard Text");
    });
  });

  describe("5. SafePaste Restoring Its Immediate Snapshot Exactly Once", () => {
    test("SafePaste snapshots pre-paste clipboard and restores its immediate snapshot exactly once without post-paste clobber", async () => {
      const initialSnapshot = port.snapshot();
      adapter.writeText("Selection text present at paste time");
      const ownershipSnapshot = port.snapshot();

      ownershipManager.setOwnership({
        sequenceId: 401,
        previousClipboard: initialSnapshot,
        hasSelection: true,
        selectedText: "Selection text present at paste time",
        ownershipSnapshot,
      });

      const basePort = createClipboardPort(adapter as unknown as ClipboardAdapter<any>);
      let restoreCount = 0;
      let injected = false;

      const trackingPort = {
        ...basePort,
        restore: (snapshot: ClipboardSnapshot) => {
          restoreCount++;
          basePort.restore(snapshot);
        },
      };

      const targetApp: TargetIdentity = { bundleId: "com.editor", appName: "Editor", pid: 10, windowId: 10 };
      const safePaste = new SafePasteService(
        () => targetApp,
        async () => { injected = true; },
        trackingPort,
        async () => {}
      );

      // Step 1: Clear selection ownership before SafePaste begins
      ownershipManager.clearOwnership(401);

      // Step 2: SafePaste executes
      await safePaste.captureTarget();
      const result = await safePaste.paste("Pasted Dictation Result");
      expect(result.ok).toBe(true);
      expect(injected).toBe(true);

      // SafePaste's internal restore ran exactly once
      expect(restoreCount).toBe(1);

      // Step 3: Main process calls restoreCapturedSelection post-paste
      const restored = ownershipManager.restoreCapturedSelection(401, port);
      expect(restored).toBe(false);

      // Total restore calls remain 1 (SafePaste alone restored its snapshot)
      expect(restoreCount).toBe(1);

      // Clipboard contains what SafePaste restored ("Selection text present at paste time")
      expect(adapter.readText()).toBe("Selection text present at paste time");
    });
  });
});
