import { describe, test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Mock DOM hierarchy to test rendering behavior in Bun node context
class MockNode {
  childNodes: MockNode[] = [];
  parentNode: MockNode | null = null;

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(val: string) {
    this.childNodes = [new MockTextNode(val)];
  }

  appendChild<T extends MockNode>(child: T): T {
    if (child instanceof MockDocumentFragment) {
      const children = [...child.childNodes];
      child.childNodes = [];
      for (const c of children) {
        c.parentNode = this;
        this.childNodes.push(c);
      }
      return child;
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild<T extends MockNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
}

class MockTextNode extends MockNode {
  nodeType = 3;

  constructor(text: string) {
    super();
    this.childNodes = [];
    this._text = text;
  }

  private _text: string;

  override get textContent(): string {
    return this._text;
  }

  override set textContent(val: string) {
    this._text = val;
  }
}

class MockElement extends MockNode {
  nodeType = 1;
  tagName: string;
  className = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  title = "";
  value = "";
  eventListeners: Record<string, Function[]> = {};

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  set innerHTML(html: string) {
    this.childNodes = [];
    if (!html) return;

    // Simulate DOM innerHTML parser behavior for checking untrusted HTML injection
    const imgMatches = html.match(/<img\s+[^>]*>/gi);
    if (imgMatches) {
      for (const _ of imgMatches) {
        this.appendChild(new MockElement("img"));
      }
    }
    const svgMatches = html.match(/<svg\s*[^>]*>/gi);
    if (svgMatches) {
      for (const _ of svgMatches) {
        this.appendChild(new MockElement("svg"));
      }
    }
    const scriptMatches = html.match(/<script\s*[^>]*>.*?<\/script>/gi);
    if (scriptMatches) {
      for (const _ of scriptMatches) {
        this.appendChild(new MockElement("script"));
      }
    }
    const btnMatches = html.match(/<button\s*([^>]*)>(.*?)<\/button>/gi);
    if (btnMatches) {
      for (const btnTag of btnMatches) {
        const btn = new MockElement("button");
        const idxMatch = btnTag.match(/data-index=["'](.*?)["']/);
        if (idxMatch && idxMatch[1] !== undefined) {
          btn.dataset.index = idxMatch[1];
        }
        this.appendChild(btn);
      }
    }
    const textOnly = html.replace(/<[^>]*>/g, "");
    if (textOnly) {
      this.appendChild(new MockTextNode(textOnly));
    }
  }

  get innerHTML(): string {
    return this.textContent;
  }

  addEventListener(event: string, handler: Function) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  async dispatchEvent(event: string) {
    const handlers = this.eventListeners[event] || [];
    for (const h of handlers) {
      await h();
    }
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? (all[0] ?? null) : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (node: MockNode) => {
      for (const child of node.childNodes) {
        if (child instanceof MockElement) {
          if (selector === "button" && child.tagName === "BUTTON") {
            results.push(child);
          } else if (selector === "img" && child.tagName === "IMG") {
            results.push(child);
          } else if (selector === "svg" && child.tagName === "SVG") {
            results.push(child);
          } else if (selector === "script" && child.tagName === "SCRIPT") {
            results.push(child);
          } else if (selector.startsWith(".") && child.className.includes(selector.slice(1))) {
            results.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  get children(): MockElement[] {
    return this.childNodes.filter((c): c is MockElement => c instanceof MockElement);
  }
}

class MockDocumentFragment extends MockNode {
  nodeType = 11;
}

// Global DOM setup for renderer tests
const elementsStore = new Map<string, MockElement>();

function getOrCreateElement(id: string, tagName = "div"): MockElement {
  if (!elementsStore.has(id)) {
    elementsStore.set(id, new MockElement(tagName));
  }
  return elementsStore.get(id)!;
}

let historyData: Array<{ text: string; timestamp: number; activeApp?: string }> = [];
let savedConfigCalls: Array<any> = [];
let lastCopiedText = "";

// Setup global mock environment before module imports
(globalThis as any).document = {
  createElement: (tagName: string) => {
    if (tagName === "select") {
      const el = new MockElement("select");
      el.value = "careful";
      return el;
    }
    return new MockElement(tagName);
  },
  createTextNode: (text: string) => new MockTextNode(text),
  createDocumentFragment: () => new MockDocumentFragment(),
  getElementById: (id: string) => elementsStore.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

(globalThis as any).navigator = {
  clipboard: {
    writeText: async (text: string) => {
      lastCopiedText = text;
    },
  },
};

(globalThis as any).window = {
  addEventListener: () => {},
  electronIPC: {
    getHistory: async () => historyData,
    saveConfig: async (config: any) => {
      savedConfigCalls.push(config);
    },
    onStateChanged: () => {},
    onAudioLevelUpdate: () => {},
    getConfig: async () => ({}),
    getStateSnapshot: async () => null,
  },
};

// Dynamic import of renderer module after setting up global document
const {
  renderPersonNames,
  renderVocabTags,
  renderHistory,
  removePersonName,
  removeVocabTerm,
  setCustomVocabForTest,
  getCustomVocabForTest,
  setPresetVocabMapForTest,
  getPresetVocabMapForTest,
} = await import("../../renderer/renderer.js");

describe("PR-01 Untrusted Rendering & CSP Security Remediation", () => {
  beforeEach(() => {
    elementsStore.clear();
    savedConfigCalls = [];
    lastCopiedText = "";

    // Prepare standard container elements
    getOrCreateElement("personNamesContainer");
    getOrCreateElement("personNamesCountBadge");
    getOrCreateElement("vocabTagsContainer");
    const presetSelect = getOrCreateElement("modalPresetSelect", "select");
    presetSelect.value = "careful";
    getOrCreateElement("historyContainer");
  });

  test("1. Person names rendering converts hostile HTML/markup into literal text nodes without executable elements", async () => {
    const personNamesContainer = getOrCreateElement("personNamesContainer");
    const hostileNames = [
      `<img src=x onerror=alert("xss")>`,
      `<svg onload=alert('svg')>`,
      `John "The Boss" & 'Quotes'`,
      `<script>alert(1)</script>`,
    ];

    setCustomVocabForTest(hostileNames);
    renderPersonNames();

    // Assert zero executable elements created inside container
    expect(personNamesContainer.querySelectorAll("img")).toHaveLength(0);
    expect(personNamesContainer.querySelectorAll("svg")).toHaveLength(0);
    expect(personNamesContainer.querySelectorAll("script")).toHaveLength(0);

    // Each child tag should contain literal text and exactly one remove button
    const tags = personNamesContainer.children;
    expect(tags).toHaveLength(4);

    tags.forEach((tag, idx) => {
      const name = hostileNames[idx];
      expect(name).toBeDefined();
      expect(tag.textContent).toContain(name!);
      const btn = tag.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn?.dataset.index).toBe(String(idx));
    });
  });

  test("2. Person name remove button removes entry and triggers config save", async () => {
    const personNamesContainer = getOrCreateElement("personNamesContainer");
    setCustomVocabForTest(["Safe Name", `<img src=x onerror=alert(1)>`]);
    renderPersonNames();

    const secondTag = personNamesContainer.children[1];
    expect(secondTag).toBeDefined();
    const removeBtn = secondTag!.querySelector("button");
    expect(removeBtn).not.toBeNull();

    await removeBtn?.dispatchEvent("click");

    expect(getCustomVocabForTest()).toEqual(["Safe Name"]);
    expect(savedConfigCalls).toHaveLength(1);
    expect(savedConfigCalls[0]).toEqual({ customVocabulary: ["Safe Name"] });
  });

  test("3. Preset vocabulary tags render hostile markup as literal text without executable elements", async () => {
    const vocabTagsContainer = getOrCreateElement("vocabTagsContainer");
    const hostileTerms = [
      `<img src=x onerror=alert("term")>`,
      `<a href="javascript:alert(1)">Link</a>`,
      `Term with "quotes" & <script>alert(1)</script>`,
    ];

    setPresetVocabMapForTest({
      careful: hostileTerms,
    });

    renderVocabTags();

    expect(vocabTagsContainer.querySelectorAll("img")).toHaveLength(0);
    expect(vocabTagsContainer.querySelectorAll("script")).toHaveLength(0);

    const tags = vocabTagsContainer.children;
    expect(tags).toHaveLength(3);

    tags.forEach((tag, idx) => {
      const term = hostileTerms[idx];
      expect(term).toBeDefined();
      expect(tag.textContent).toContain(term!);
      const btn = tag.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn?.dataset.index).toBe(String(idx));
    });
  });

  test("4. Preset vocabulary tag remove button removes term and saves config", async () => {
    const vocabTagsContainer = getOrCreateElement("vocabTagsContainer");
    setPresetVocabMapForTest({
      careful: ["term1", `<img src=x onerror=alert(1)>`],
    });

    renderVocabTags();

    const secondTag = vocabTagsContainer.children[1];
    expect(secondTag).toBeDefined();
    const removeBtn = secondTag!.querySelector("button");
    await removeBtn?.dispatchEvent("click");

    expect(getPresetVocabMapForTest().careful).toEqual(["term1"]);
    expect(savedConfigCalls).toHaveLength(1);
  });

  test("5. History rendering converts hostile activeApp and text into literal text and safe clipboard actions", async () => {
    const historyContainer = getOrCreateElement("historyContainer");
    historyData = [
      {
        text: `Hostile text <svg/onload=alert('xss')>`,
        timestamp: Date.now(),
        activeApp: `MaliciousApp <img src=x onerror=alert(1)>`,
      },
    ];

    await renderHistory();

    expect(historyContainer.querySelectorAll("img")).toHaveLength(0);
    expect(historyContainer.querySelectorAll("svg")).toHaveLength(0);

    const historyItem = historyContainer.querySelector(".history-item");
    expect(historyItem).not.toBeNull();

    const textEl = historyItem?.querySelector(".history-text");
    const metaEl = historyItem?.querySelector(".history-meta");

    expect(textEl?.textContent).toBe(`Hostile text <svg/onload=alert('xss')>`);
    expect(metaEl?.textContent).toContain(`MaliciousApp <img src=x onerror=alert(1)>`);

    // Simulate clicking history item to copy
    await historyItem?.dispatchEvent("click");
    expect(lastCopiedText).toBe(`Hostile text <svg/onload=alert('xss')>`);

    // Ensure meta element shows feedback without executing markup or corrupting text
    expect(metaEl?.textContent).toContain("✓ Copied to clipboard!");
  });

  test("6. Build/Package CSP assertion: all renderer HTML pages carry required Content Security Policy meta headers", () => {
    const pages = ["index.html", "capture.html", "hud.html"];
    const baseSrcDir = path.resolve(__dirname, "../../../src/renderer");
    const baseOutDir = path.resolve(__dirname, "../../../out/renderer");

    pages.forEach((pageFile) => {
      const srcPath = path.join(baseSrcDir, pageFile);
      expect(fs.existsSync(srcPath)).toBe(true);

      const htmlContent = fs.readFileSync(srcPath, "utf8");
      expect(htmlContent).toContain(`http-equiv="Content-Security-Policy"`);

      // Extract CSP header content
      const cspMatch = htmlContent.match(/content="([^"]+)"/i);
      expect(cspMatch).not.toBeNull();

      const csp = cspMatch && cspMatch[1] ? cspMatch[1] : "";
      expect(csp).not.toBe("");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-src 'none'");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");

      // Negative assertions: script-src must not allow unsafe-inline or unsafe-eval
      const scriptDirective = csp.match(/script-src\s+([^;]+)/i)?.[1] || "";
      expect(scriptDirective).not.toContain("'unsafe-inline'");
      expect(scriptDirective).not.toContain("'unsafe-eval'");
    });

    // Check built output if present
    if (fs.existsSync(baseOutDir)) {
      pages.forEach((pageFile) => {
        const outPath = path.join(baseOutDir, pageFile);
        if (fs.existsSync(outPath)) {
          const htmlContent = fs.readFileSync(outPath, "utf8");
          expect(htmlContent).toContain(`http-equiv="Content-Security-Policy"`);
        }
      });
    }
  });
});
