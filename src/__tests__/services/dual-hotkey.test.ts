import { describe, expect, test } from "bun:test";
import { parseKeyBinding, formatKeyDisplay } from "../../services/config.js";

describe("Dual Hotkey Configuration & Parsing Suite", () => {
  test("parses dictation key binding (Ctrl+Cmd+Opt+V) correctly", () => {
    const binding = parseKeyBinding("ctrl+cmd+option+v");
    expect(binding.ctrl).toBe(true);
    expect(binding.meta).toBe(true);
    expect(binding.alt).toBe(true);
  });

  test("parses edit key binding (Ctrl+Cmd+Opt+E) correctly", () => {
    const editBinding = parseKeyBinding("ctrl+cmd+option+e");
    expect(editBinding.ctrl).toBe(true);
    expect(editBinding.meta).toBe(true);
    expect(editBinding.alt).toBe(true);
    expect(formatKeyDisplay(editBinding)).toContain("E");
  });
});
