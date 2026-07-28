import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("VO HUD Usefulness & Aesthetic Pass Contract Suite", () => {
  const hudHtmlPath = resolve(process.cwd(), "src/renderer/hud.html");
  const mainTsPath = resolve(process.cwd(), "src/main.ts");
  const preloadTsPath = resolve(process.cwd(), "src/preload.ts");

  const hudHtmlContent = readFileSync(hudHtmlPath, "utf-8");
  const mainTsContent = readFileSync(mainTsPath, "utf-8");
  const preloadTsContent = readFileSync(preloadTsPath, "utf-8");

  describe("1. Visual Identity & Lovevish Translucent Capsule Preservation", () => {
    test("preserves translucent glass background, backdrop filter, and quiet contrast edge", () => {
      expect(hudHtmlContent).toContain("backdrop-filter: blur(28px) saturate(180%)");
      expect(hudHtmlContent).toContain("border: 1px solid rgba(255, 255, 255, 0.14)");
      expect(hudHtmlContent).toContain("box-shadow:");
      expect(hudHtmlContent).toContain(".hud-capsule");
    });

    test("includes 5 waveform bars with smooth height transition easing", () => {
      expect(hudHtmlContent).toContain("transition: height 0.15s cubic-bezier(0.4, 0, 0.2, 1)");
      const barMatches = hudHtmlContent.match(/<div class="hud-bar"><\/div>/g);
      expect(barMatches?.length).toBe(5);
    });
  });

  describe("2. Starting / Prewarming Visual State", () => {
    test("gives starting state its own distinct cyan theme, icon, and wave animation", () => {
      expect(hudHtmlContent).toContain(".hud-capsule.starting");
      expect(hudHtmlContent).toContain("#06B6D4"); // Cyan theme color
      expect(hudHtmlContent).toContain("@keyframes wave-cyan");
      expect(hudHtmlContent).toContain("STARTING");
      expect(hudHtmlContent).toContain("Connecting...");
    });

    test("starting state is clearly distinguishable from recording, transcribing, and error states", () => {
      expect(hudHtmlContent).toContain(".hud-capsule.recording");
      expect(hudHtmlContent).toContain("#EF4444"); // Red recording
      expect(hudHtmlContent).toContain(".hud-capsule.transcribing");
      expect(hudHtmlContent).toContain("#F59E0B"); // Amber transcribing
      expect(hudHtmlContent).toContain(".hud-capsule.error");
      expect(hudHtmlContent).toContain("#F97316"); // Alert orange/red error
    });
  });

  describe("3. Multi-modal Meaning (Icon + Title + Color)", () => {
    test("defines distinct SVG icons and titles for every AppState and edit mode", () => {
      expect(hudHtmlContent).toContain("stateIcons");
      expect(hudHtmlContent).toContain("idle:");
      expect(hudHtmlContent).toContain("starting:");
      expect(hudHtmlContent).toContain("recording:");
      expect(hudHtmlContent).toContain("stopping:");
      expect(hudHtmlContent).toContain("transcribing:");
      expect(hudHtmlContent).toContain("thinking:");
      expect(hudHtmlContent).toContain("speaking:");
      expect(hudHtmlContent).toContain("error:");
      expect(hudHtmlContent).toContain("selection:");

      expect(hudHtmlContent).toContain("defaultTitles");
      expect(hudHtmlContent).toContain("DONE");
      expect(hudHtmlContent).toContain("STARTING");
      expect(hudHtmlContent).toContain("RECORDING");
      expect(hudHtmlContent).toContain("STOPPING");
      expect(hudHtmlContent).toContain("TRANSCRIBING");
      expect(hudHtmlContent).toContain("THINKING");
      expect(hudHtmlContent).toContain("SPEAKING");
      expect(hudHtmlContent).toContain("ERROR");
    });

    test("selection mode displays 'EDITING' or 'SELECTION' title and text detail", () => {
      expect(hudHtmlContent).toContain("EDITING");
      expect(hudHtmlContent).toContain("Transform selection");
      expect(hudHtmlContent).toContain("SELECTION");
      expect(hudHtmlContent).toContain("Edit selected text");
    });
  });

  describe("4. Non-Focus-Stealing Cancellation & Escape Path Preservation", () => {
    test("cancel button has no-drag region and prevents default mousedown to stop focus theft", () => {
      expect(hudHtmlContent).toContain("-webkit-app-region: no-drag");
      expect(hudHtmlContent).toContain("hudCancelBtn.addEventListener(\"mousedown\", (e) => {");
      expect(hudHtmlContent).toContain("e.preventDefault()");
      expect(hudHtmlContent).toContain("api.cancelDictation()");
    });

    test("main window configures HUD as focusable: false with 280x36 bounds", () => {
      expect(mainTsContent).toContain("width = 280");
      expect(mainTsContent).toContain("height = 36");
      expect(mainTsContent).toContain("focusable: false");
      expect(mainTsContent).toContain("alwaysOnTop: true");
    });

    test("preload API exports cancelDictation IPC channel", () => {
      expect(preloadTsContent).toContain("cancelDictation:");
      expect(preloadTsContent).toContain("CANCEL_DICTATION");
    });
  });

  describe("5. Actionable Errors & Timing", () => {
    test("holds error state for 6000ms instead of fast 1500ms auto-hide", () => {
      expect(mainTsContent).toContain("else if (state === \"error\")");
      expect(mainTsContent).toContain("6000");
    });

    test("shows error icon, detail payload message, and dismiss button in HUD", () => {
      expect(hudHtmlContent).toContain("hudCancelBtn.setAttribute(\"aria-label\", \"Dismiss error\")");
      expect(hudHtmlContent).toContain("hudCancelBtn.setAttribute(\"title\", \"Dismiss\")");
      expect(hudHtmlContent).toContain("defaultDetails");
      expect(hudHtmlContent).toContain("An error occurred");
    });
  });

  describe("6. Reduced Motion Handling", () => {
    test("handles prefers-reduced-motion by disabling animations and preserving readable static states", () => {
      expect(hudHtmlContent).toContain("@media (prefers-reduced-motion: reduce)");
      expect(hudHtmlContent).toContain("animation: none !important");
      expect(hudHtmlContent).toContain("transition: none !important");
      expect(hudHtmlContent).toContain(".hud-bar:nth-child(1) { height: 6px; }");
      expect(hudHtmlContent).toContain(".hud-bar:nth-child(2) { height: 14px; }");
    });
  });
});
