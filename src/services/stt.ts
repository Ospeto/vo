import OpenAI, { toFile } from "openai";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SpeechProvider, DictationPreset } from "./config.js";
import type { DictionaryEntry, GeminiModelChoice } from "../shared/types.js";
import { applyDictionary } from "./dictionary-engine.js";
import { loadPersistedVocabulary, dictionaryEntryFromTerm, migrateVocabulary } from "./vocabulary-service.js";
import { getGeminiClient } from "./gemini-client.js";
import { scanWorkspaceSymbols } from "./symbol-scanner.js";
import logger from "./logger.js";
import { elevenLabsFetch } from "./elevenlabs.js";
import { ensureOwnerOnlyPermissions } from "../shared/permission-utils.js";

const execAsync = promisify(exec);

const DICTIONARY_DIR = join(homedir(), ".pi");
const DICTIONARY_FILE = join(DICTIONARY_DIR, "dictionary.txt");

let cachedUserDictionary: string[] | null = null;
let lastDictionaryReadTime = 0;

export function loadUserDictionary(): string[] {
  const now = Date.now();
  if (cachedUserDictionary && now - lastDictionaryReadTime < 10000) {
    return cachedUserDictionary;
  }
  if (!existsSync(DICTIONARY_FILE)) {
    cachedUserDictionary = [];
    lastDictionaryReadTime = now;
    return cachedUserDictionary;
  }
  ensureOwnerOnlyPermissions(DICTIONARY_FILE);
  try {
    const raw = readFileSync(DICTIONARY_FILE, "utf-8");
    cachedUserDictionary = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    lastDictionaryReadTime = now;
    return cachedUserDictionary;
  } catch {
    cachedUserDictionary = [];
    lastDictionaryReadTime = now;
    return cachedUserDictionary;
  }
}

export function appendUserDictionary(word: string): void {
  try {
    if (!existsSync(DICTIONARY_DIR)) {
      mkdirSync(DICTIONARY_DIR, { recursive: true });
    }
    const term = word.trim();
    if (term.length > 0) {
      appendFileSync(DICTIONARY_FILE, `\n${term}`, { mode: 0o600 });
      ensureOwnerOnlyPermissions(DICTIONARY_FILE);
      cachedUserDictionary = null; // Invalidate cache
      logger.info({ charCount: term.length }, "Appended new term to personal vocabulary dictionary");
    }
  } catch (err) {
    logger.error({ err: String(err) }, "Failed to append term to personal vocabulary dictionary");
  }
}

export function prewarmGeminiClient(): void {
  try {
    const client = getGeminiClient();
    if (client) {
      logger.info("Pre-warmed Gemini client connection successfully");
    }
    loadUserDictionary();
    void getActiveAppName();
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to pre-warm Gemini client connection");
  }
}

import { loadNativePasteAddon, resolveNativePastePath } from "./native-paste-addon.js";

let cachedActiveAppName = "Unknown";
let lastActiveAppTime = 0;

export async function getActiveAppName(): Promise<string> {
  const now = Date.now();
  if (cachedActiveAppName !== "Unknown" && now - lastActiveAppTime < 3000) {
    return cachedActiveAppName;
  }

  try {
    const root = process.cwd();
    const addonPath = resolveNativePastePath(root);
    const addon = loadNativePasteAddon(addonPath);
    if (addon) {
      const target = addon.capture();
      if (target && target.ok && target.appName) {
        cachedActiveAppName = target.appName;
        lastActiveAppTime = now;
        return cachedActiveAppName;
      }
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "Failed to capture active app via native addon");
  }

  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
      { timeout: 800 },
    );
    cachedActiveAppName = stdout.trim() || "Unknown";
    lastActiveAppTime = now;
  } catch (err) {
    logger.debug({ err: String(err) }, "Failed to get active app via osascript");
  }
  return cachedActiveAppName || "Unknown";
}

/** Vector 3: Context-Aware Dynamic Dictionary Injection */
export function getAppContextPromptHint(appName: string): string {
  const lower = appName.toLowerCase();

  if (
    lower.includes("terminal") ||
    lower.includes("warp") ||
    lower.includes("iterm") ||
    lower.includes("ghostty") ||
    lower.includes("alacritty") ||
    lower.includes("myanso")
  ) {
    return (
      "Active Window: Terminal/CLI.\n" +
      "Vocabulary Hints: git, bun, pkill, launchd, brew, clang, electron, npm, node, cd, ls, mkdir, rm -rf, status, build, start, stop, doctor.\n" +
      "Formatting: Favor Unix shell commands, flags, and file paths. Do NOT add trailing full stops (။)."
    );
  }

  if (lower.includes("obsidian")) {
    return (
      "Active Window: Obsidian Vault.\n" +
      "Vocabulary Hints: MAS 141, MAS 142, MAS 143, SarYayKaung, Ospeto, TBH Labs, Engram, FSRS, NotebookLM, Diablo, Batch Receipts, Daily Note.\n" +
      "Formatting: Favor Burmese prose, academic terms, and task lists."
    );
  }

  if (
    lower.includes("code") ||
    lower.includes("cursor") ||
    lower.includes("zed") ||
    lower.includes("sublime") ||
    lower.includes("myanso") ||
    lower.includes("terminal") ||
    lower.includes("iterm") ||
    lower.includes("warp") ||
    lower.includes("ghostty") ||
    lower.includes("alacritty")
  ) {
    return (
      "Active Window: Developer Coding Terminal & Text Editor.\n" +
      "Vocabulary Hints: const, interface, async, await, function, TypeScript, JavaScript, export, import, return, let, type, String, Boolean, Array, audit, refactor, commit, diff, error, bug.\n" +
      "Formatting: Favor programming syntax, code comments, and technical specification imperatives."
    );
  }

  if (
    lower.includes("chrome") ||
    lower.includes("safari") ||
    lower.includes("arc") ||
    lower.includes("firefox")
  ) {
    return (
      "Active Window: Web Browser.\n" +
      "Vocabulary Hints: Firecrawl, NotebookLM, GitHub, API, documentation, search query, Ospeto, SarYayKaung.\n" +
      "Formatting: Favor search queries and web tech terms."
    );
  }

  return `Active Window: ${appName}`;
}

export function resolveEffectivePreset(
  preset?: DictationPreset,
  appName?: string,
  customMappings?: Record<string, DictationPreset>
): DictationPreset {
  if (preset !== "auto") return preset ?? "careful";
  if (!appName) return "careful";

  const lower = appName.toLowerCase();

  if (customMappings) {
    for (const [key, mappedPreset] of Object.entries(customMappings)) {
      if (lower.includes(key.toLowerCase())) {
        return mappedPreset;
      }
    }
  }

  if (
    lower.includes("code") ||
    lower.includes("cursor") ||
    lower.includes("terminal") ||
    lower.includes("warp") ||
    lower.includes("iterm") ||
    lower.includes("ghostty") ||
    lower.includes("alacritty") ||
    lower.includes("myanso") ||
    lower.includes("zed") ||
    lower.includes("sublime")
  ) {
    return "code_comment";
  }

  if (
    lower.includes("slack") ||
    lower.includes("mail") ||
    lower.includes("outlook") ||
    lower.includes("telegram") ||
    lower.includes("teams") ||
    lower.includes("messages")
  ) {
    return "email_polish";
  }

  if (
    lower.includes("obsidian") ||
    lower.includes("notion") ||
    lower.includes("bear") ||
    lower.includes("pages") ||
    lower.includes("word")
  ) {
    return "burmese_written";
  }

  return "careful";
}

const GLOBAL_BILINGUAL_DIRECTIVE = `
GLOBAL NATURAL BILINGUAL DICTATION DIRECTIVE:
The speaker naturally mixes spoken Burmese natural prose with English technical terms, acronyms, code identifiers, and CLI commands.
1. PRESERVE NATURAL BILINGUAL DUAL-LANGUAGE FLOW: Transcribe spoken Burmese text in clean Burmese script (မြန်မာစာ) and spoken English technical terms, identifiers, and commands in exact English (e.g. "Database connection ကို test လုပ်ပြီး တွေ့တဲ့ error ကို log ထုတ်ပေး").
2. DO NOT FORCE TRANSLATION: Do NOT forcibly translate spoken Burmese words to English, and do NOT forcibly translate English technical terms into Burmese. Keep English technical terms, commands, and product names in exact English.
3. SPOKEN IDENTIFIER HINTS: Format spoken code cues ("camel case user id" -> userId, "snake case created at" -> created_at) cleanly as code symbols.
4. SPOKEN HESITATION PURGING: Completely ignore and filter out all spoken vocalizations, throat-clearing, and hesitation filler phonemes (e.g. 'အာ', 'ဟာ', 'အင်း', 'အင်', 'အာ့', 'အမ်', 'ဟိုဟာ', 'ဒီဥစ္စာ', 'like', 'you know', 'nd-sat', 'um', 'uh'). Do NOT transcribe these vocal fillers into text.
`.trim();

export function getPresetPromptInstructions(preset?: DictationPreset, translateEnabled?: boolean): string {
  switch (preset) {
    case "code_comment":
      if (translateEnabled) {
        return `
Preset Mode: SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION (TRANSLATION MODE).
Translate the developer's spoken Burmese/English dictation directly into clean, precise, professional English technical specifications optimized for AI coding assistants (Cursor / Antigravity / Claude / Copilot).

CORE DIRECTIVES:
1. FAITHFUL TRANSLATION & ZERO IMPROVISATION: Translate spoken Burmese/English directly into clean technical English specifications. Do NOT invent unmentioned requirements, unsaid state management, unsaid code blocks, or extra architectural steps. Output ONLY what the user explicitly dictated.
2. CONCISE IMPERATIVE STRUCTURING: Convert spoken intent into clear, direct English engineering specifications and imperatives (e.g., "user id မပါရင် ဘာမှမလုပ်ဘဲ ပြန်ထွက်" -> "Return early if userId is null or undefined").
3. SPOKEN IDENTIFIER FORMATTING: Convert spoken variable naming cues into precise code identifiers:
   - "camel case user id" -> userId
   - "snake case created at" -> created_at
   - "pascal case user response" -> UserResponse
   - "upper case api key" -> API_KEY
   - "kebab case user-card" -> user-card
4. STRICT ENGLISH ONLY (ZERO BURMESE SCRIPT): Output ONLY pure English text. Under NO circumstances should any Burmese script, Burmese characters (မြန်မာစာ), conversational preambles ("Here is the specification:"), or raw dictation repeats be included.
5. ZERO BOILERPLATE & ZERO PREAMBLES: Output NO conversational intros, commentary, or unrequested code blocks. Return ONLY clean technical specifications ready for AI coding agents.
`.trim();
      }
      return `
Preset Mode: SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION (DETECT MODE).
Transcribe spoken audio (Burmese or English) faithfully in its original spoken language. Apply syntax-friendly code formatting, identifier casing, inline backticks, and code comments. Do NOT force English translation.

CORE DIRECTIVES:
1. FAITHFUL TRANSCRIPTION IN ORIGINAL LANGUAGE: Transcribe spoken Burmese text in clean Burmese script (မြန်မာစာ) and spoken English technical terms in exact English. Do NOT forcibly translate spoken Burmese into English when translation mode is inactive.
2. SYNTAX-FRIENDLY CODE FORMATTING & COMMENTS: Apply syntax-friendly code formatting, inline backticks for code symbols (\`userId\`, \`created_at\`), and inline code comment structure (# or //) where dictated.
3. SPOKEN IDENTIFIER FORMATTING: Convert spoken variable naming cues into precise code identifiers:
   - "camel case user id" -> userId
   - "snake case created at" -> created_at
   - "pascal case user response" -> UserResponse
   - "upper case api key" -> API_KEY
   - "kebab case user-card" -> user-card
4. ZERO CONVERSATIONAL PREAMBLES & ZERO BOILERPLATE: Output NO conversational intros (e.g. "Here is the specification:"), NO unrequested boilerplate code generation, and NO arbitrary rewriting. Output ONLY clean, direct prompts/specifications or inline code comments ready for AI coding agents.
`.trim();
    case "translate":
      return `
Preset Mode: TRANSLATE TO ENGLISH & CAREFUL DEEP PROOFREADING.
Hear the spoken Burmese/English audio and directly output its accurate, fluent, carefully proofread, and natural English translation.

CORE CAREFUL DIRECTIVES:
1. CAREFUL DEEP PROOFREADING: Perform deep semantic proofreading on the English translation. Fix grammatical errors, awkward phraseology, phonetically garbled words, and speech slips while preserving 100% of the speaker's core intent.
2. NATURAL & TECHNICAL ENGLISH: Output clear, fluent, professional English prose.
3. ZERO BURMESE SCRIPT: Output ONLY pure English text. Under NO circumstances should any Burmese script (မြန်မာစာ), intros, or wrapping quotes be included.
`.trim();
    case "burmese_written":
      return `
${GLOBAL_BILINGUAL_DIRECTIVE}

Preset Mode: BURMESE WRITTEN PROSE & BILINGUAL ACCURACY.
When translation mode is inactive, transcribe spoken audio into fluent, natural written prose in its original spoken language. Accurately preserve embedded English technical terms, proper nouns, and acronyms in exact English script.
`.trim();
    case "email_polish":
      return `
${GLOBAL_BILINGUAL_DIRECTIVE}

Preset Mode: EMAIL & MESSAGE POLISHING.
Transcribe spoken audio into clean, professional email/messaging prose while accurately preserving embedded technical terms, code identifiers, and acronyms.
`.trim();
    case "careful":
      return `
${GLOBAL_BILINGUAL_DIRECTIVE}

Preset Mode: CAREFUL DEEP PROOFREADING & SEMANTIC REASONING.
Analyze the spoken audio meticulously. Perform deep proofreading to correct phonetically garbled words, homophones, awkward phrasing, and speech slips. Format the output into highly coherent, grammatically flawless, natural text while strictly preserving 100% of the speaker's core intent, meaning, and technical terminology.
CRITICAL: You MUST transcribe and proofread EVERY SINGLE WORD spoken from beginning to end. Never truncate, drop trailing words, or cut off sentences mid-way. Output 100% complete, fully-formed text.
`.trim();
    case "fast":
    default:
      return GLOBAL_BILINGUAL_DIRECTIVE;
  }
}

const SAFE_ENGLISH_REPEAT_WORDS =
  "the|a|an|and|or|but|in|on|at|to|for|of|with|by|from|is|are|was|were|be|been|being|have|has|will|would|should|could|can|this|these|those|it|its|they|them|their|we|our|us|you|your|my";
const SAFE_REPEAT_WORD_REGEX = new RegExp(`\\b(${SAFE_ENGLISH_REPEAT_WORDS})[ \\t]+\\1\\b`, "gi");
const CODE_REGION_REGEX = /(```[\s\S]*?```|`[^`\n]*`)/g;

function transformOutsideCodeRegions(text: string, transform: (segment: string) => string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(CODE_REGION_REGEX)) {
    const index = match.index ?? 0;
    result += transform(text.slice(lastIndex, index)) + match[0];
    lastIndex = index + match[0].length;
  }
  return result + transform(text.slice(lastIndex));
}

function removeSpokenRepeats(text: string): string {
  const removeRepeats = (segment: string) => {
    let cleanedSegment = segment.replace(/\b(ဒီ|ဟို|အာ)[ \t]+\1\b/gi, "$1");
    cleanedSegment = cleanedSegment.replace(SAFE_REPEAT_WORD_REGEX, "$1");
    return cleanedSegment.replace(/(?:^|[ \t]+)([^\s.,?!:;။၊]+(?:[ \t]+[^\s.,?!:;။၊]+){0,4})(?:[ \t]+\1)+(?=[ \t]|[.,?!:;။၊]|$)/gi, (match, fragment) => {
      const norm = fragment.trim().toLowerCase();
      if (norm === "that" || norm === "had") {
        return match;
      }
      const leadingSpace = match.startsWith(" ") || match.startsWith("\t") ? " " : "";
      return leadingSpace + fragment;
    });
  };

  return transformOutsideCodeRegions(text, removeRepeats);
}

export const BURMESE_UNICODE_REGEX = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/;

const CASING_CONNECTORS = new Set([
  "and", "or", "then", "so", "for", "with", "from", "where", "if", "when", "to", "in", "by",
  "should", "will", "is", "was", "be", "are", "were", "must", "can", "could", "would", "has", "have", "does", "do", "used"
]);

function parseCasingWords(phrase: string): { words: string[]; rest: string } {
  const rawWords = phrase.trim().split(/\s+/);
  const words: string[] = [];
  let i = 0;
  for (; i < Math.min(rawWords.length, 3); i++) {
    const raw = rawWords[i];
    if (!raw) break;
    const cleanedWord = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanedWord) break;
    if (words.length > 0 && CASING_CONNECTORS.has(cleanedWord)) break;
    const subWords = cleanedWord.split(/[-_]/).filter(Boolean);
    words.push(...subWords);
  }
  const rest = rawWords.slice(i).join(" ");
  return { words, rest: rest ? ` ${rest}` : "" };
}

export function sanitizeCodePresetText(text: string): string {
  if (!text) return "";
  return transformOutsideCodeRegions(text.trim(), (segment) => {
    let cleaned = segment;

    // 1. Spoken casing commands transformation
    cleaned = cleaned.replace(/\bcamel case ([a-zA-Z0-9_\- ]+)\b/gi, (_m, p1) => {
      const { words, rest } = parseCasingWords(p1);
      const first = words[0];
      if (!first) return _m;
      const camel = first + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
      return `\`${camel}\`${rest}`;
    });

    cleaned = cleaned.replace(/\bsnake case ([a-zA-Z0-9_\- ]+)\b/gi, (_m, p1) => {
      const { words, rest } = parseCasingWords(p1);
      if (words.length === 0) return _m;
      return `\`${words.join("_")}\`${rest}`;
    });

    cleaned = cleaned.replace(/\bpascal case ([a-zA-Z0-9_\- ]+)\b/gi, (_m, p1) => {
      const { words, rest } = parseCasingWords(p1);
      if (words.length === 0) return _m;
      const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
      return `\`${pascal}\`${rest}`;
    });

    cleaned = cleaned.replace(/\bupper case ([a-zA-Z0-9_\- ]+)\b/gi, (_m, p1) => {
      const { words, rest } = parseCasingWords(p1);
      if (words.length === 0) return _m;
      return `\`${words.join("_").toUpperCase()}\`${rest}`;
    });

    cleaned = cleaned.replace(/\bkebab case ([a-zA-Z0-9_\- ]+)\b/gi, (_m, p1) => {
      const { words, rest } = parseCasingWords(p1);
      if (words.length === 0) return _m;
      return `\`${words.join("-")}\`${rest}`;
    });

    // 2. Strip conversational intro preambles
    cleaned = cleaned.replace(/^(Here is the (?:specification|spec|code comment|comment):)\s*/gi, "");

    return cleaned;
  });
}

export function sanitizeTranscribedText(text: string, activeApp?: string, preset?: DictationPreset, dictionaryEntries?: DictionaryEntry[], translateEnabled?: boolean, _targetLanguage?: string): string {
  if (!text) return "";

  const effectivePreset = resolveEffectivePreset(preset, activeApp);
  const effectiveDictionaryEntries = dictionaryEntries ?? loadPersistedVocabulary().entries ?? [];
  let cleaned = text.trim();

  // 1. Strip wrapping quotes added by LLMs
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if ((cleaned.startsWith("“") && cleaned.endsWith("”")) || (cleaned.startsWith("‘") && cleaned.endsWith("’"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // 2. Convert spoken newline / line break commands
  cleaned = cleaned.replace(/\s*(စာကြောင်းသစ်|\bnew line\b|\bnewline\b)\s*/gi, "\n");

  // 3. Convert spoken bullet point commands
  cleaned = cleaned.replace(/(^|\n)\s*(\bbullet point\b|\bbullet\b|အချက်)\s+/gi, "$1- ");

  // 4. Convert spoken punctuation commands
  cleaned = cleaned.replace(/\s*(စက်ဖြတ်|ပုဒ်မဖြတ်|ပုဒ်မ|\bfull stop\b)\s*/gi, "။ ");
  cleaned = cleaned.replace(/\s*(ကော်မာ|\bcomma\b)\s*/gi, ", ");
  cleaned = cleaned.replace(/\s*(ပုဒ်ဖြတ်|ပုဒ်ထီး)\s*/gi, "၊ ");
  cleaned = cleaned.replace(/\s*(မေးခွန်းသင်္ကေတ|\bquestion mark\b)\s*/gi, "? ");
  cleaned = cleaned.replace(/\s*(အာမေဋိတ်|\bexclamation mark\b|\bexclamation point\b)\s*/gi, "! ");
  cleaned = cleaned.replace(/\s*(ခေါ်လွန်|\bcolon\b)\s*/gi, ": ");
  cleaned = cleaned.replace(/\s*\bsemicolon\b\s*/gi, "; ");

  // 4. Strip throat clearing and vocalization sounds
  cleaned = cleaned.replace(/^(အဟမ်းး|အဟမ်း|အဟက်|အဟွတ်)\s*,?\s*/gi, "");

  // 5. Dual-Layer Precision Morphological Anti-Hesitation Sanitizer
  // Targets standalone hesitation phonemes (အာ, ဟာ, အင်း, အင်, အမ်, အာ့) followed by punctuation, ellipses, or spaces
  cleaned = cleaned.replace(/(?:^|\s+)(?:အာ+|ဟာ+|အင်း+|အင်+|အမ်+|အမ်း+|အာ့+)(?:[။.,…\-–—\s]*)(?=\s|[။.,…]|$)/g, " ");
  cleaned = cleaned.replace(/^(ဟိုဟာလေ|ဟိုဟာ|အာ့ဆို|အာ့|အင်းး|အင်း|အမ်မ်|အမ်|ဒီဥစ္စာ|အာ)\s*,?\s*/gi, "");
  cleaned = cleaned.replace(/\s*(,\s*nd-sat|,\s*nd\s*sat|,\s*nd)\s*/gi, "");
  cleaned = cleaned.replace(/\b(like|you know)\s*,\s*/gi, "");
  cleaned = cleaned.replace(/\s+(ဟိုဟာလေ|ဟိုဟာ|ဒီဥစ္စာ)\s+/gi, " ");

  // 6. Remove repetitive word stutters & duplicate multi-word fragments (up to 5 words)
  cleaned = removeSpokenRepeats(cleaned);

  // 7. Collapse multi-spaces & clean double punctuation
  cleaned = transformOutsideCodeRegions(cleaned, (segment) => segment
    .replace(/[ \t]+/g, " ")
    .replace(/။+/g, "။")
    .replace(/၊+/g, "၊")
    .replace(/\?+/g, "?")
    .replace(/!+/g, "!")
    .replace(/,+/g, ","));

  // 8. Convert spoken task checklist command ("task: <text>" -> "- [ ] <text>")
  if (/^(task:|တာဝန်:)\s*/i.test(cleaned)) {
    cleaned = cleaned.replace(/^(task:|တာဝန်:)\s*/i, "- [ ] ");
  }

  // 9. Convert spoken code block command ("code: <text>" -> ```\n<text>\n```)
  if (/^(code:|အကုဒ်:)\s*/i.test(cleaned)) {
    const codeBody = cleaned.replace(/^(code:|အကုဒ်:)\s*/i, "").trim();
    cleaned = "```\n" + codeBody + "\n```";
  }

  // 10. Terminal / CLI Punctuation Sanitizer:
  if (activeApp) {
    const lowerApp = activeApp.toLowerCase();
    if (
      lowerApp.includes("terminal") ||
      lowerApp.includes("warp") ||
      lowerApp.includes("iterm") ||
      lowerApp.includes("ghostty") ||
      lowerApp.includes("alacritty")
    ) {
      cleaned = cleaned.replace(/[။.?]+$/g, "").trim();
    }
  }

  // 11. Fix spacing around punctuation (remove spaces before punctuation, ensure single space after punctuation)
  cleaned = transformOutsideCodeRegions(cleaned, (segment) => segment.replace(/\s+([,.?!:;\u104E\u104F])/g, "$1"));

  // 12. Smart English Auto-Capitalization after sentence boundaries (Skip for URLs)
  if (!/^(https?:\/\/|ftp:\/\/|git@)/i.test(cleaned)) {
    cleaned = transformOutsideCodeRegions(cleaned, (segment) => segment.replace(/(^|\n\s*|\n\s*-\s*|[។.!?]\s+)([a-z])/g, (_match, prefix, char) => prefix + char.toUpperCase()));
  }

  // 13. Fix spacing around Burmese full stop (။) and Burmese comma (၊)
  cleaned = transformOutsideCodeRegions(cleaned, (segment) => segment
    .replace(/။([^\s\n"')\]}])/g, "။ $1")
    .replace(/၊([^\s\n"')\]}])/g, "၊ $1")
    .replace(/\s+။/g, "။")
    .replace(/\s+၊/g, "၊"));

  // 14. Code Preset Transformations (casing commands, preamble stripping)
  if (effectivePreset === "code_comment" && translateEnabled === true) {
    cleaned = sanitizeCodePresetText(cleaned);
  }

  // Dictionary is deliberately last: every provider receives the same local, exact result.
  return applyDictionary(cleaned.trim(), effectiveDictionaryEntries).trim();
}

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// ── Gemini STT ───────────────────────────────────────────────────────

const BURMESE_ACCURATE_STT_PROMPT = `
You are a high-precision Burmese & English Speech-to-Text transcriber.
CRITICAL RULES:
1. ALWAYS transcribe spoken Burmese words in standard Burmese Unicode script (မြန်မာအက္ခရာ) (e.g. "မရဘူး", "အဆင်မပြေဘူး", "ပေါ်လာတာ"). NEVER use English/Latin letters for Burmese words (No Burmish like "MaYaBuu").
2. Only write standard English technical/project terms in English script (e.g. SarYayKaung, Ospeto, TBH, Engram, MAS 141, MAS 142, MAS 143, FSRS, SQL, Python, VPN, Image, Wolf).
3. Transcribe only what was actually spoken. Do NOT hallucinate lists of vocabulary words. No intro or markdown wrappers.
4. PHONETIC ACCURACY FOR PERSON NAMES: You MUST transcribe person names, family names, and proper nouns using their EXACT target Burmese/English spelling (e.g. 'သော်ဇင်' NOT 'တော်စင်', 'အောင်ချမ်းမြေ့' NOT 'အွန်တန်းမြေ', 'ကို Joy' NOT 'ကိုဂျွိုင်း', 'ဝေယံထက်' NOT 'ဝေယံ', 'မိုးကျော်အောင်' NOT 'မိုးကျော်'). NEVER garble spoken names into phonetically similar unrelated Burmese words.
5. NEVER truncate, drop trailing words, or cut off sentences mid-way. Output 100% complete, fully-formed transcription for the entire audio.
`.trim();

function migrateLegacyHintEntries(terms: string[]): DictionaryEntry[] {
  return terms.map((term) => dictionaryEntryFromTerm(term)).filter((entry): entry is DictionaryEntry => Boolean(entry));
}

export const MAX_HINT_ENTRIES = 50;
export const MAX_HINT_TERMS = 200;

/**
 * Prepares a bounded, deduplicated list of enabled trusted dictionary entries
 * with conflicting aliases excluded, suitable for soft recognition hints.
 */
export function prepareHintEntries(
  entries: DictionaryEntry[],
  maxEntries: number = MAX_HINT_ENTRIES,
  maxTerms: number = MAX_HINT_TERMS
): DictionaryEntry[] {
  const entryLimit = Math.max(0, Math.floor(maxEntries));
  const termLimit = Math.max(0, Math.floor(maxTerms));
  if (!entries || entries.length === 0 || entryLimit === 0 || termLimit === 0) return [];

  // 1. Filter enabled entries with non-empty canonical phrase
  const enabled = entries.filter(
    (e) => e.enabled !== false && typeof e.phrase === "string" && e.phrase.trim().length > 0
  );
  if (enabled.length === 0) return [];

  // 2. Identify conflicting aliases (alias mapping to multiple distinct canonical phrases)
  const aliasToPhrases = new Map<string, Set<string>>();
  for (const entry of enabled) {
    const normPhrase = entry.phrase.trim().normalize("NFKC").toLocaleLowerCase();
    const aliases = [entry.phrase, ...(entry.spokenAliases || [])];
    for (const rawAlias of aliases) {
      if (typeof rawAlias !== "string") continue;
      const alias = rawAlias.trim();
      if (!alias) continue;
      const normAlias = alias.normalize("NFKC").toLocaleLowerCase();
      let phrases = aliasToPhrases.get(normAlias);
      if (!phrases) {
        phrases = new Set();
        aliasToPhrases.set(normAlias, phrases);
      }
      phrases.add(normPhrase);
    }
  }

  const conflictingAliases = new Set<string>();
  for (const [normAlias, phrases] of aliasToPhrases.entries()) {
    if (phrases.size > 1) {
      conflictingAliases.add(normAlias);
    }
  }

  // 3. Build deduplicated entry list without conflicting aliases
  const prepared: DictionaryEntry[] = [];
  const seenPhrases = new Set<string>();
  let termCount = 0;

  for (const entry of enabled) {
    const phrase = entry.phrase.trim();
    const normPhrase = phrase.normalize("NFKC").toLocaleLowerCase();

    const rawAliases = Array.isArray(entry.spokenAliases) ? entry.spokenAliases : [];
    const validAliases: string[] = [];
    const seenAliasNorms = new Set<string>();

    for (const rawAlias of [phrase, ...rawAliases]) {
      if (typeof rawAlias !== "string") continue;
      const alias = rawAlias.trim();
      if (!alias) continue;
      const normAlias = alias.normalize("NFKC").toLocaleLowerCase();
      if (conflictingAliases.has(normAlias)) continue;
      if (!seenAliasNorms.has(normAlias)) {
        seenAliasNorms.add(normAlias);
        validAliases.push(alias);
      }
    }

    if (seenPhrases.has(normPhrase)) {
      const existing = prepared.find(
        (e) => e.phrase.trim().normalize("NFKC").toLocaleLowerCase() === normPhrase
      );
      if (existing) {
        for (const alias of validAliases) {
          const normAlias = alias.normalize("NFKC").toLocaleLowerCase();
          if (!existing.spokenAliases.some((a) => a.normalize("NFKC").toLocaleLowerCase() === normAlias)) {
            if (termCount >= termLimit) break;
            existing.spokenAliases.push(alias);
            termCount += 1;
          }
        }
      }
    } else {
      const boundedAliases = validAliases.slice(0, termLimit - termCount);
      if (boundedAliases.length === 0) break;
      seenPhrases.add(normPhrase);
      termCount += boundedAliases.length;
      prepared.push({
        id: entry.id,
        phrase,
        spokenAliases: boundedAliases.filter((a) => a.normalize("NFKC").toLocaleLowerCase() !== normPhrase),
        enabled: true,
        category: entry.category,
        ...(entry.legacyWhitespace ? { legacyWhitespace: true } : {}),
      });
    }

    if (prepared.length >= entryLimit || termCount >= termLimit) {
      break;
    }
  }

  return prepared;
}

export function buildDictionaryPromptPart(entries: DictionaryEntry[]): string {
  const prepared = prepareHintEntries(entries, MAX_HINT_ENTRIES);
  if (prepared.length === 0) return "";

  const lines = prepared.map((entry) => {
    const aliases = Array.from(new Set([entry.phrase, ...entry.spokenAliases].map((s) => s.trim()).filter(Boolean)));
    if (aliases.length > 1) {
      return `- Spoken sound/word "${aliases.join('" or "')}" ➔ Preferred spelling: "${entry.phrase}"`;
    }
    return `- Preferred spelling: "${entry.phrase}"`;
  });

  return `\nRECOGNITION VOCABULARY HINTS (soft guidance only; use only when supported by audio):\nWhen the speaker says any of these words or sounds, prefer these exact canonical spellings:\n${lines.join("\n")}\n`;
}

export function buildCustomVocabularyPromptPart(terms: string[]): string {
  if (!terms || terms.length === 0) return "";
  const entries = migrateLegacyHintEntries(terms);
  return buildDictionaryPromptPart(entries);
}

export function buildOpenAIVocabularyPrompt(entries: DictionaryEntry[]): string {
  const prepared = prepareHintEntries(entries, 30);
  if (prepared.length === 0) return "";
  const terms: string[] = [];
  for (const entry of prepared) {
    terms.push(entry.phrase);
    for (const alias of entry.spokenAliases) {
      terms.push(alias);
    }
  }
  return Array.from(new Set(terms)).join(", ");
}

export interface TranscribeOptions {
  provider?: SpeechProvider;
  geminiModel?: GeminiModelChoice;
  dictationPreset?: DictationPreset;
  translateEnabled?: boolean;
  targetLanguage?: string;
  fileExtension?: string;
  customVocabulary?: string[];
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>;
  dictionaryEntries?: DictionaryEntry[];
  symbolScannerEnabled?: boolean;
  workspacePath?: string;
  selectedText?: string;
  abortSignal?: AbortSignal;
  activeApp?: string;
}

export function getPresetTemperature(_preset?: DictationPreset): number {
  return 0.0;
}

export function getFallbackModelChain(
  preferredModel: GeminiModelChoice,
  _effectivePreset?: DictationPreset
): string[] {
  const fallbackCandidates: string[] = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-1.5-flash",
  ];

  const filtered = fallbackCandidates.filter((m) => m !== preferredModel);
  return Array.from(new Set([preferredModel, ...filtered]));
}

export function formatSelectedTextForPrompt(text: string): string {
  const safeText = text.replace(/<\/selected_text>/gi, "&lt;/selected_text&gt;");
  return `<selected_text>\n${safeText}\n</selected_text>`;
}

async function transcribeGemini(
  audioBuffer: Buffer,
  preferredModel: GeminiModelChoice = "gemini-3.1-flash-lite",
  dictationPreset?: DictationPreset,
  customVocabulary?: string[],
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>,
  dictionaryEntries: DictionaryEntry[] = [],
  symbolScannerEnabled: boolean = true,
  workspacePath?: string,
  translateEnabled?: boolean,
  targetLanguage?: string,
  selectedText?: string,
  abortSignal?: AbortSignal
): Promise<{ rawText: string; activeApp: string; usedPaidKey?: boolean }> {
  if (abortSignal?.aborted) {
    throw new Error("Transcription aborted");
  }
  const client = getGeminiClient();
  const base64Audio = audioBuffer.toString("base64");

  const activeApp = await getActiveAppName();
  const appContextHint = getAppContextPromptHint(activeApp);

  let appMappings: Record<string, DictationPreset> | undefined;
  let isTranslationActive = translateEnabled;
  let resolvedTargetLang = targetLanguage;

  try {
    const { loadConfig } = await import("./config.js");
    const cfg = loadConfig();
    appMappings = cfg.appPresetMappings;
    if (isTranslationActive === undefined) {
      isTranslationActive = cfg.translateEnabled ?? false;
    }
    if (!resolvedTargetLang) {
      resolvedTargetLang = cfg.targetLanguage || "English";
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "Failed to load config for Gemini STT translation check");
  }
  if (!resolvedTargetLang) {
    resolvedTargetLang = "English";
  }

  const resolvedPreset = resolveEffectivePreset(dictationPreset, activeApp, appMappings);
  const effectivePreset = resolvedPreset === "translate" ? "careful" : resolvedPreset;
  if (resolvedPreset === "translate") {
    isTranslationActive = true;
  }
  const presetHint = getPresetPromptInstructions(effectivePreset, isTranslationActive);
  const targetTemperature = getPresetTemperature(effectivePreset);

  const diskTerms = loadUserDictionary();
  const presetTerms = presetVocabulary?.[effectivePreset] || [];
  const hintEntries = dictionaryEntries.length > 0
    ? dictionaryEntries
    : migrateLegacyHintEntries([...diskTerms, ...(customVocabulary || []), ...presetTerms]);

  const dictPromptPart = buildDictionaryPromptPart(hintEntries);

  let workspacePromptPart = "";
  if (symbolScannerEnabled !== false) {
    const targetDir = workspacePath || process.cwd();
    const scan = scanWorkspaceSymbols(targetDir);
    if (scan.symbols.length > 0 || scan.fileNames.length > 0) {
      workspacePromptPart = `\nActive Workspace Identifiers (${scan.workspaceName}): ${scan.symbols.join(", ")}\nFiles: ${scan.fileNames.join(", ")}\n`;
    }
  }

  const hasSelectedText = Boolean(selectedText && selectedText.trim().length > 0);
  const isCodePreset = effectivePreset === "code_comment";
  let sttBasePrompt = BURMESE_ACCURATE_STT_PROMPT;
  let userPromptText = "Transcribe the spoken audio accurately in its original spoken language (Burmese or English).";

  if (hasSelectedText) {
    const translationDirective = isTranslationActive
      ? `\nTRANSLATION DIRECTIVE: Translation mode is ACTIVE. Target language is ${resolvedTargetLang}. If the spoken audio is an editing or translation command, or if translating the selected text, produce the result in ${resolvedTargetLang}.`
      : `\nTRANSLATION DIRECTIVE: Translation mode is INACTIVE. Maintain original language of selected text and spoken dictation. Do NOT force translation to ${resolvedTargetLang} unless spoken audio explicitly dictates a translation target.`;

    const codeDirective = isCodePreset
      ? `\nCODING PRESET DIRECTIVE: Coding mode is ACTIVE. Apply syntax-friendly code formatting, identifier casing ("camel case user id" -> userId, "snake case created at" -> created_at, "pascal case user response" -> UserResponse), inline backticks, or inline code comments as requested. Ensure ZERO conversational preambles ("Here is the specification:") and ZERO unrequested code block boilerplate.`
      : "";

    sttBasePrompt = `You are an expert AI Dual-Mode Voice Editor and Dictation Assistant. Your task is to analyze the spoken audio together with the provided [SELECTED TEXT].${translationDirective}${codeDirective}

EVALUATION RULES:
1. ACTION INSTRUCTION: If the spoken audio contains an editing, refactoring, or translation command (e.g. "add code comments", "convert to camel case", "refactor this function", "translate into English", "fix grammar", "make bullet points", "rephrase", "summarize", "make shorter", "rewrite"), apply that command to the [SELECTED TEXT] and return ONLY the modified replacement text or comments.
2. NEW DICTATION: If the spoken audio is new text or dictation content, ignore the [SELECTED TEXT] and return ONLY the clean transcription of the new spoken audio.

OUTPUT FORMAT: Return ONLY the final result text without any quotes, introductory phrases, or explanatory commentary.`;
    const formattedSelectedText = formatSelectedTextForPrompt(selectedText!.trim());
    userPromptText = `[SELECTED TEXT]:\n${formattedSelectedText}\n\nSPOKEN AUDIO: Listen to the audio. If it's an editing/refactoring/translation command, transform the selected text. If it's new dictation content, transcribe the new audio directly. Output ONLY the final text.`;
  } else if (isCodePreset) {
    if (isTranslationActive) {
      sttBasePrompt = `You are an expert real-time Speech Translator and Code Specification Architect. Your single imperative task is to listen to the spoken audio and output ONLY its clean, technical translation into ${resolvedTargetLang} with software engineering specification formatting. Ensure ZERO conversational preambles ("Here is the specification:"), ZERO unrequested boilerplate code generation, and ZERO arbitrary rewriting. Output ONLY clean, direct prompts/specifications or inline code comments ready for AI coding assistants (Cursor, Antigravity, Claude, Copilot).`;
      userPromptText = `Translate the spoken audio into clear technical specifications in ${resolvedTargetLang}. Output ONLY clean specifications without conversational intros or boilerplate code blocks.`;
    } else {
      sttBasePrompt = `You are an expert real-time Speech Dictation and Code Specification Architect. Your single imperative task is to listen to the spoken audio (in Burmese, English, or technical code terms) and transcribe/format it accurately in its original spoken language with syntax-friendly formatting, technical identifier spellings ("camel case user id" -> userId, "snake case created at" -> created_at, "pascal case user response" -> UserResponse), inline backticks, and inline code comment structure. Preserve the spoken language (Burmese or English) faithfully. Ensure ZERO conversational preambles ("Here is the specification:"), ZERO unrequested boilerplate code generation, and ZERO arbitrary rewriting. Output ONLY clean, direct prompts/specifications or inline code comments ready for AI coding assistants.`;
      userPromptText = "Transcribe the spoken audio with syntax-friendly technical code formatting in its original spoken language. Do NOT force translation unless auto-translation is active.";
    }
  } else if (isTranslationActive) {
    sttBasePrompt = `You are an expert real-time Speech Translator. Your single imperative task is to listen to the spoken audio and output ONLY its clean, natural translation into ${resolvedTargetLang}. Output ONLY pure ${resolvedTargetLang} text without any commentary.`;
    userPromptText = `Translate the spoken audio directly into clean, natural ${resolvedTargetLang}. Output ONLY ${resolvedTargetLang} text.`;
  }

  const fullPrompt = `${sttBasePrompt}\n${appContextHint}${workspacePromptPart}${dictPromptPart}${presetHint}`;

  // Dynamically scale primary timeout from 12s to 25s based on audio payload byte length
  const dynamicTimeoutMs = Math.max(12000, Math.min(25000, Math.ceil(audioBuffer.length / 5)));

  // Model fallback chain: preferred model first
  const modelsToTry = getFallbackModelChain(preferredModel, effectivePreset);
  let paidFallbackInFlight: Promise<unknown> | null = null;

  const { getGeminiFallbackClient, isFallbackClient } = await import("./gemini-client.js");
  const fallbackClient = getGeminiFallbackClient();
  const isPaidClient = isFallbackClient(client);

  let hasPaidConfig = false;
  try {
    const { loadConfig } = await import("./config.js");
    const cfg = loadConfig();
    hasPaidConfig = Boolean(cfg.geminiFallbackApiKey && cfg.geminiFallbackApiKey.trim());
  } catch (err) {
    logger.debug({ err: String(err) }, "Failed to check paid config for Gemini STT");
  }

  const initialUsedPaidKey = isPaidClient || hasPaidConfig;

  for (const model of modelsToTry) {
    if (abortSignal?.aborted) {
      throw new Error("Transcription aborted");
    }
    try {
      const runPrimary = async () => {
        if (abortSignal?.aborted) throw new Error("Transcription aborted");
        const response = await client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "audio/webm", data: base64Audio } },
                { text: userPromptText },
              ],
            },
          ],
          config: {
            systemInstruction: fullPrompt,
            temperature: targetTemperature,
            maxOutputTokens: 8192,
            abortSignal,
          },
        });
        const text = response.text?.trim() ?? "";
        return { text, usedPaidKey: initialUsedPaidKey };
      };

      const primaryPromise = runPrimary();

      let resultPromise: Promise<{ text: string; usedPaidKey: boolean }>;
      const fallbackAbortController = new AbortController();
      if (abortSignal) {
        if (abortSignal.aborted) fallbackAbortController.abort();
        else abortSignal.addEventListener("abort", () => fallbackAbortController.abort(), { once: true });
      }

      if (fallbackClient && !paidFallbackInFlight) {
        let timerId: ReturnType<typeof setTimeout> | undefined;
        const primaryDelayTimer = new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error("Primary Key delay > 2000ms")), 2000);
          if (timerId && typeof timerId === "object" && "unref" in timerId) (timerId as any).unref();
        });

        resultPromise = (async () => {
          try {
            const res = await Promise.race([primaryPromise, primaryDelayTimer]);
            if (timerId) clearTimeout(timerId);
            return res;
          } catch (primaryErr: any) {
            if (timerId) clearTimeout(timerId);
            logger.info({ model, err: primaryErr?.message }, "Primary API Key took >2000ms or errored; triggering Parallel Paid Fallback Key");
            try {
              const paidRequest = fallbackClient.models.generateContent({
                model,
                contents: [
                  {
                    role: "user",
                    parts: [
                      { inlineData: { mimeType: "audio/webm", data: base64Audio } },
                      { text: userPromptText },
                    ],
                  },
                ],
                config: {
                  systemInstruction: fullPrompt,
                  temperature: targetTemperature,
                  maxOutputTokens: 8192,
                  abortSignal: fallbackAbortController.signal,
                },
              });
              const trackedPaidRequest = paidRequest.finally(() => {
                if (!fallbackAbortController.signal.aborted && paidFallbackInFlight === trackedPaidRequest) {
                  paidFallbackInFlight = null;
                }
              });
              paidFallbackInFlight = trackedPaidRequest;
              const fbResponse = await trackedPaidRequest;
              const fbText = fbResponse.text?.trim() ?? "";
              return { text: fbText, usedPaidKey: true };
            } catch (fbErr: any) {
              logger.warn({ model, fbErr: fbErr?.message }, "Paid Fallback Key also failed");
              throw fbErr;
            }
          }
        })();
      } else {
        resultPromise = primaryPromise;
      }

      let timeoutTimerId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimerId = setTimeout(() => reject(new Error(`Model ${model} timed out after ${dynamicTimeoutMs}ms`)), dynamicTimeoutMs);
        if (timeoutTimerId && typeof timeoutTimerId === "object" && "unref" in timeoutTimerId) (timeoutTimerId as any).unref();
      });

      let winner: { text: string; usedPaidKey: boolean };
      try {
        winner = await Promise.race([resultPromise, timeoutPromise]);
      } finally {
        if (timeoutTimerId) clearTimeout(timeoutTimerId);
        fallbackAbortController.abort();
      }
      let text = winner.text;

      // Bulletproof Fallback: If Code preset was requested AND translation is active, but non-editing response contains Burmese script, run fast text translation
      const isTranslationRequested = isTranslationActive === true;
      if (isCodePreset && isTranslationRequested && !hasSelectedText && /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(text)) {
        if (!abortSignal?.aborted) {
          logger.info({ model, charCount: text.length }, "Gemini STT output contained Burmese script in English preset, executing text translation fallback");
          try {
            const translateRes = await client.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: `You are a Senior Software Engineer. Translate the following Burmese dictation into a clean, precise English technical specification for an AI coding assistant. Output ONLY pure English text without any Burmese script:\n\n${text}`,
              config: {
                temperature: 0.0,
                abortSignal,
              },
            });
            const translatedText = translateRes.text?.trim();
            if (translatedText && !/[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(translatedText)) {
              text = translatedText;
            }
          } catch (translateErr: any) {
            logger.warn({ err: translateErr?.message || String(translateErr) }, "Text translation fallback failed");
          }
        }
      }

      logger.info({ model, preferredModel, activeApp, customTermsCount: hintEntries.length, dictationPreset, charCount: text.length, byteLength: audioBuffer.length, usedPaidKey: winner.usedPaidKey }, "Gemini STT transcribed successfully");
      return { rawText: text, activeApp, usedPaidKey: winner.usedPaidKey };
    } catch (err: any) {
      logger.warn({ model, preferredModel, err: err?.message || String(err) }, "Model attempt failed, moving to next candidate");
    }
  }

  throw new Error("All Gemini STT models failed to transcribe audio");
}

async function transcribeOpenAI(audioBuffer: Buffer, promptText?: string, abortSignal?: AbortSignal): Promise<string> {
  if (abortSignal?.aborted) throw new Error("Transcription aborted");
  const client = getOpenAIClient();

  const file = await toFile(audioBuffer, "recording.webm");
  const transcription = await client.audio.transcriptions.create(
    {
      model: "gpt-4o-mini-transcribe",
      file,
      ...(promptText ? { prompt: promptText } : {}),
    },
    { signal: abortSignal }
  );

  return transcription.text?.trim() ?? "";
}

async function transcribeElevenLabs(audioBuffer: Buffer, abortSignal?: AbortSignal): Promise<string> {
  if (abortSignal?.aborted) throw new Error("Transcription aborted");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" }), "recording.webm");
  form.append("model_id", "scribe_v2");

  const response = await elevenLabsFetch("/v1/speech-to-text", {
    method: "POST",
    body: form,
    signal: abortSignal,
  });
  const result = await response.json() as { text?: string; transcripts?: Array<{ text?: string }> };
  return (result.text ?? result.transcripts?.[0]?.text ?? "").trim();
}

async function transcribeLocal(audioData: ArrayBuffer, abortSignal?: AbortSignal): Promise<string> {
  if (abortSignal?.aborted) throw new Error("Transcription aborted");
  try {
    const { Whisper, WhisperFullParams, WhisperSamplingStrategy } = await import("@napi-rs/whisper");
    const { resolveModelPath } = await import("./whisper-model.js");
    const modelPath = await resolveModelPath();
    const whisper = new Whisper(modelPath);
    const params = new WhisperFullParams(WhisperSamplingStrategy.Greedy);
    params.language = "auto";
    params.noTimestamps = true;

    const float32Samples = new Float32Array(audioData);
    const result = await whisper.full(params, float32Samples);
    return typeof result === "string" ? result.trim() : "";
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Local Whisper STT failed");
    throw err;
  }
}

export interface TranscriptionResult {
  text: string;
  usedPaidKey: boolean;
  modelUsed: string;
}

export async function transcribeDetailed(
  audioData: ArrayBuffer,
  providerOrOptions: SpeechProvider | TranscribeOptions = "gemini"
): Promise<TranscriptionResult> {
  let rawText = "";
  let usedPaidKey = false;
  const activeApp = typeof providerOrOptions === "object" && providerOrOptions.activeApp ? providerOrOptions.activeApp : await getActiveAppName();

  const provider = typeof providerOrOptions === "string" ? providerOrOptions : (providerOrOptions.provider ?? "gemini");
  const geminiModel = typeof providerOrOptions === "object" ? (providerOrOptions.geminiModel ?? "gemini-3.1-flash-lite") : "gemini-3.1-flash-lite";
  const dictationPreset = typeof providerOrOptions === "object" ? providerOrOptions.dictationPreset : "fast";
  const customVocabulary = typeof providerOrOptions === "object" ? providerOrOptions.customVocabulary : [];
  const presetVocabulary = typeof providerOrOptions === "object" ? providerOrOptions.presetVocabulary : {};
  const symbolScannerEnabled = typeof providerOrOptions === "object" ? providerOrOptions.symbolScannerEnabled ?? true : true;
  const workspacePath = typeof providerOrOptions === "object" ? providerOrOptions.workspacePath : undefined;
  const translateEnabled = typeof providerOrOptions === "object" ? providerOrOptions.translateEnabled : undefined;
  const targetLanguage = typeof providerOrOptions === "object" ? providerOrOptions.targetLanguage : undefined;
  const selectedText = typeof providerOrOptions === "object" ? providerOrOptions.selectedText : undefined;
  const abortSignal = typeof providerOrOptions === "object" ? providerOrOptions.abortSignal : undefined;
  const persistedVocabulary = loadPersistedVocabulary();
  const dictionaryEntries = typeof providerOrOptions === "object" && providerOrOptions.dictionaryEntries !== undefined
    ? providerOrOptions.dictionaryEntries
    : migrateVocabulary(customVocabulary || [], presetVocabulary || {}, persistedVocabulary.entries || [], loadUserDictionary());

  let isTranslationActive = translateEnabled;
  let appPresetMappings: Record<string, DictationPreset> | undefined;
  try {
    const { loadConfig } = await import("./config.js");
    const cfg = loadConfig();
    appPresetMappings = cfg.appPresetMappings;
    if (isTranslationActive === undefined) {
      isTranslationActive = cfg.translateEnabled ?? false;
    }
  } catch {
    isTranslationActive = isTranslationActive ?? false;
  }

  let effectiveTargetLang = targetLanguage;
  if (!effectiveTargetLang) {
    try {
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig();
      effectiveTargetLang = cfg.targetLanguage;
    } catch {
      effectiveTargetLang = undefined;
    }
  }

  const rawPreset = resolveEffectivePreset(dictationPreset, activeApp, appPresetMappings);
  const effectivePreset = rawPreset === "translate" ? "careful" : rawPreset;
  if (rawPreset === "translate") {
    isTranslationActive = true;
  }

  const isTranslationTargetingNonBurmese = isTranslationActive === true && (effectiveTargetLang ?? "English") !== "Burmese";

  if (isTranslationTargetingNonBurmese && !abortSignal?.aborted) {
    const { executeTwoStepTranslation } = await import("./two-step-translation.js");
    const result = await executeTwoStepTranslation(audioData, {
      sourceProvider: provider,
      geminiModel,
      dictationPreset: dictationPreset ?? effectivePreset,
      customVocabulary,
      presetVocabulary,
      dictionaryEntries,
      symbolScannerEnabled,
      workspacePath,
      targetLanguage: effectiveTargetLang,
      selectedText,
      abortSignal,
      activeApp,
    });

    if (result.success && result.finalText) {
      const finalText = result.finalText;
      if (BURMESE_UNICODE_REGEX.test(finalText)) {
        throw new Error("Translation incomplete: Burmese script remained in transcript");
      }
      return {
        text: finalText,
        usedPaidKey: result.translationStage?.usedPaidKey || result.sourceStage.usedPaidKey || false,
        modelUsed: result.translationStage?.modelUsed || result.sourceStage.modelUsed || geminiModel,
      };
    } else {
      if (result.sourceStage?.status === "cancelled" || result.translationStage?.status === "cancelled") {
        const cancelErr = new Error("Transcription cancelled");
        cancelErr.name = "AbortError";
        throw cancelErr;
      }
      throw new Error(result.errorReason || "Two-step translation failed");
    }
  }

  switch (provider) {
    case "local":
      rawText = await transcribeLocal(audioData, abortSignal);
      break;
    case "openai": {
      const openaiPrompt = buildOpenAIVocabularyPrompt(dictionaryEntries);
      rawText = await transcribeOpenAI(Buffer.from(audioData), openaiPrompt, abortSignal);
      usedPaidKey = true;
      break;
    }
    case "elevenlabs":
      rawText = await transcribeElevenLabs(Buffer.from(audioData), abortSignal);
      usedPaidKey = true;
      break;
    case "gemini":
    default: {
      const res = await transcribeGemini(
        Buffer.from(audioData),
        geminiModel,
        dictationPreset,
        customVocabulary,
        presetVocabulary,
        dictionaryEntries,
        symbolScannerEnabled,
        workspacePath,
        translateEnabled,
        targetLanguage,
        selectedText,
        abortSignal
      );
      rawText = res.rawText;
      usedPaidKey = res.usedPaidKey ?? false;
      break;
    }
  }

  const sanitized = sanitizeTranscribedText(rawText, activeApp, effectivePreset, dictionaryEntries, provider === "gemini" && isTranslationActive === true && !abortSignal?.aborted, effectiveTargetLang);

  if (isTranslationTargetingNonBurmese && BURMESE_UNICODE_REGEX.test(sanitized)) {
    throw new Error("Translation incomplete: Burmese script remained in transcript");
  }

  logger.info({ provider, geminiModel, dictationPreset, effectivePreset, activeApp, rawCharCount: rawText.length, sanitizedCharCount: sanitized.length, usedPaidKey }, "Transcribed detailed and sanitized");
  return { text: sanitized, usedPaidKey, modelUsed: geminiModel };
}

export async function transcribe(
  audioData: ArrayBuffer,
  providerOrOptions: SpeechProvider | TranscribeOptions = "gemini"
): Promise<string> {
  const res = await transcribeDetailed(audioData, providerOrOptions);
  return res.text;
}
