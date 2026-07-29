import type { SafePasteResult } from "./safe-paste.js";

export type PasteOperationResult =
  | { status: "submitted" }
  | { status: "denied"; reason: string }
  | { status: "error"; reason: string }
  | { status: "duplicate" }
  | { status: "stale"; reason: string };

export class PasteCoordinator {
  private isPasting = false;
  private lastSubmittedText = "";
  private lastPasteTime = 0;
  private generation = 0;

  constructor(private readonly paste: (text: string, isCurrent: () => boolean) => Promise<SafePasteResult>) {}

  invalidate(): void { ++this.generation; }

  async pasteText(
    text: string,
    sequenceOrIsCurrent?: number | (() => boolean),
    isCurrentTranscription?: (sequence: number) => boolean
  ): Promise<PasteOperationResult> {
    const now = Date.now();
    if (this.isPasting || (text === this.lastSubmittedText && now - this.lastPasteTime < 1500)) {
      return { status: "duplicate" };
    }

    const initialGen = this.generation;
    const isCurrent = (): boolean => {
      if (initialGen !== this.generation) return false;
      if (typeof sequenceOrIsCurrent === "function") return sequenceOrIsCurrent();
      if (typeof sequenceOrIsCurrent === "number" && typeof isCurrentTranscription === "function") {
        return isCurrentTranscription(sequenceOrIsCurrent);
      }
      return true;
    };

    if (!isCurrent()) {
      return { status: "stale", reason: "Paste invalidated; transcript was retained" };
    }

    this.isPasting = true;
    try {
      const result = await this.paste(text, isCurrent);
      if (!isCurrent()) return { status: "stale", reason: "Paste invalidated; transcript was retained" };
      if (result.ok) {
        this.lastSubmittedText = text;
        this.lastPasteTime = Date.now();
        return { status: "submitted" };
      }
      return { status: "denied", reason: result.reason };
    } catch (error) {
      if (!isCurrent()) return { status: "stale", reason: "Paste invalidated; transcript was retained" };
      return { status: "error", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      this.isPasting = false;
    }
  }
}
