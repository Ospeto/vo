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

  async pasteText(text: string): Promise<PasteOperationResult> {
    const now = Date.now();
    if (this.isPasting || (text === this.lastSubmittedText && now - this.lastPasteTime < 1500)) {
      return { status: "duplicate" };
    }

    this.isPasting = true;
    const generation = this.generation;
    this.lastSubmittedText = text;
    this.lastPasteTime = now;
    try {
      const result = await this.paste(text, () => generation === this.generation);
      if (generation !== this.generation) return { status: "stale", reason: "Paste invalidated; transcript was retained" };
      return result.ok ? { status: "submitted" } : { status: "denied", reason: result.reason };
    } catch (error) {
      if (generation !== this.generation) return { status: "stale", reason: "Paste invalidated; transcript was retained" };
      return { status: "error", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      this.isPasting = false;
    }
  }
}
