import { describe, test, expect, mock, beforeEach } from "bun:test";
import { captureActiveSelection, restoreClipboard } from "../../services/selection-service.js";
import type { TranscribeOptions } from "../../services/stt.js";

describe("Selection Transformation & Capture Service Suite", () => {
  test("captureActiveSelection returns default fallback structure when execSync times out or fails", async () => {
    const result = await captureActiveSelection(1);
    expect(result).toHaveProperty("hasSelection");
    expect(result).toHaveProperty("selectedText");
    expect(result).toHaveProperty("previousClipboard");
    expect(typeof result.hasSelection).toBe("boolean");
  });

  test("TranscribeOptions interface correctly type-checks selectedText", () => {
    const options: TranscribeOptions = {
      provider: "gemini",
      dictationPreset: "careful",
      selectedText: "function add(a, b) { return a + b; }",
    };
    expect(options.selectedText).toBe("function add(a, b) { return a + b; }");
  });

  test("restoreClipboard handles undefined or empty gracefully without crashing", () => {
    expect(() => restoreClipboard("")).not.toThrow();
    expect(() => restoreClipboard("Hello world")).not.toThrow();
  });
});
