import { describe, test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("VO UI Fixes Suite", () => {
  test("1. Target Language Display: HTML carries #translate-lang-display and no 'English to' prefix options", () => {
    const htmlPath = path.join(process.cwd(), "src/renderer/index.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");

    expect(htmlContent).toContain('id="translate-lang-display"');
    expect(htmlContent).not.toContain("English to Spanish");
    expect(htmlContent).not.toContain("English to Burmese");
    expect(htmlContent).toContain('<option value="Spanish">Spanish</option>');
    expect(htmlContent).toContain('<option value="Burmese">Burmese (မြန်မာ)</option>');
    expect(htmlContent).toContain('<option value="none">None</option>');
  });

  test("2. Unified Single-Tone Background: HTML header and footer do not contain contrasting dark bar backgrounds", () => {
    const htmlPath = path.join(process.cwd(), "src/renderer/index.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");

    const headerMatch = htmlContent.match(/<header[^>]*>/i);
    expect(headerMatch).not.toBeNull();
    expect(headerMatch![0]).not.toContain("bg-black/20");

    const footerMatch = htmlContent.match(/<footer[^>]*id="footerStatus"[^>]*>/i);
    expect(footerMatch).not.toBeNull();
    expect(footerMatch![0]).not.toContain("bg-black/20");
    expect(footerMatch![0]).not.toContain("backdrop-blur-md");
  });

  test("3. Transcription History UI: History section is visible and accessible in index.html", () => {
    const htmlPath = path.join(process.cwd(), "src/renderer/index.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");

    expect(htmlContent).toContain('class="history-section');
    expect(htmlContent).toContain('id="historyContainer"');
    expect(htmlContent).toContain('id="clearHistoryBtn"');
    expect(htmlContent).not.toContain('<div class="history-section hidden">');
  });

  test("4. CSS Surface Tone: .footer in style.css has transparent background", () => {
    const cssPath = path.join(process.cwd(), "src/renderer/style.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    const footerBlock = cssContent.match(/\.footer\s*\{[^}]*\}/i);
    expect(footerBlock).not.toBeNull();
    expect(footerBlock![0]).toContain("background: transparent;");

    const historyListBlock = cssContent.match(/\.history-list\s*\{[^}]*\}/i);
    expect(historyListBlock).not.toBeNull();
    expect(historyListBlock![0]).toContain("max-height: 160px;");
  });
});
