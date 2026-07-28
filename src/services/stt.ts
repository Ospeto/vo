import OpenAI, { toFile } from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync, exec } from "node:child_process";
import type { SpeechProvider, GeminiModelChoice, DictationPreset } from "./config.js";
import type { DictionaryEntry } from "../shared/types.js";
import { applyDictionary } from "./dictionary-engine.js";
import { loadPersistedVocabulary, dictionaryEntryFromTerm, migrateVocabulary } from "./vocabulary-service.js";
import { getGeminiClient } from "./gemini-client.js";
import { scanWorkspaceSymbols } from "./symbol-scanner.js";
import logger from "./logger.js";

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
      appendFileSync(DICTIONARY_FILE, `\n${term}`);
      cachedUserDictionary = null; // Invalidate cache
      logger.info({ term }, "Appended new term to personal vocabulary dictionary");
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
    getActiveAppName();
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to pre-warm Gemini client connection");
  }
}

import { loadNativePasteAddon, resolveNativePastePath } from "./native-paste-addon.js";

let cachedActiveAppName = "Unknown";
let lastActiveAppTime = 0;

export function getActiveAppName(): string {
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
  } catch {}

  try {
    const appName = execSync(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
      { encoding: "utf-8", timeout: 800 }
    ).trim();
    cachedActiveAppName = appName || "Unknown";
    lastActiveAppTime = now;
    return cachedActiveAppName;
  } catch {
    return cachedActiveAppName || "Unknown";
  }
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

export function getPresetPromptInstructions(preset?: DictationPreset): string {
  switch (preset) {
    case "code_comment":
      return `
Preset Mode: SYSTEMATIC CODE DICTATION & TECHNICAL INSTRUCTION.
Transcribe and translate the developer's spoken Burmese/English dictation into clean, direct, systematic English instructions for AI coding assistants (Cursor / Antigravity / Claude / Copilot).

CORE DIRECTIVES:
1. FAITHFUL TRANSLATION & ZERO IMPROVISATION: Translate spoken Burmese/English directly into clean technical English without inventing unmentioned requirements, unsaid state management, unsaid code blocks, or extra architectural steps. Output ONLY what the user explicitly dictated.
2. CONCISE IMPERATIVE STRUCTURING: Convert spoken intent into clear, direct English engineering imperatives (e.g., "user id မပါရင် ဘာမှမလုပ်ဘဲ ပြန်ထွက်" -> "Return early if userId is null or undefined").
3. SPOKEN IDENTIFIER FORMATTING: Convert spoken variable naming cues into precise code identifiers:
   - "camel case user id" -> userId
   - "snake case created at" -> created_at
   - "pascal case data model" -> DataModel
   - "upper case api key" -> API_KEY
   - "kebab case user-card" -> user-card
4. STRICT ENGLISH ONLY (ZERO BURMESE SCRIPT): Output ONLY pure English text. Under NO circumstances should any Burmese script, Burmese characters (မြန်မာစာ), conversational preambles ("Here is the instruction:"), or raw dictation repeats be included.
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

export function sanitizeTranscribedText(text: string, activeApp?: string, preset?: DictationPreset, dictionaryEntries?: DictionaryEntry[]): string {
  if (!text) return "";

  const effectivePreset = resolveEffectivePreset(preset, activeApp);
  const effectiveDictionaryEntries = dictionaryEntries ?? loadPersistedVocabulary().entries ?? [];
  let cleaned = text.trim();

  // Filter out unwanted Burmese raw text lines or inline Burmese script ONLY when code_comment preset is active AND translate toggle is ON
  if (effectivePreset === "code_comment") {
    // Only purge Burmese script if code_comment is combined with active translation toggle
    // If translate toggle is OFF, preserve Burmese characters faithfully!
  }

  // 1. Strip wrapping quotes added by LLMs
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if ((cleaned.startsWith("“") && cleaned.endsWith("”")) || (cleaned.startsWith("‘") && cleaned.endsWith("’"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // 2. Convert spoken newline / line break commands
  cleaned = cleaned.replace(/\s*(စာကြောင်းသစ်|new line|newline)\s*/gi, "\n");

  // 3. Convert spoken bullet point commands
  cleaned = cleaned.replace(/(^|\n)\s*(bullet point|bullet|အချက်)\s+/gi, "$1- ");

  // 4. Convert spoken punctuation commands
  cleaned = cleaned.replace(/\s*(စက်ဖြတ်|full stop)\s*/gi, "။ ");
  cleaned = cleaned.replace(/\s*(ကော်မာ|comma)\s*/gi, ", ");

  // 4. Strip throat clearing and vocalization sounds
  cleaned = cleaned.replace(/^(အဟမ်းး|အဟမ်း|အဟက်|အဟွတ်)\s*,?\s*/gi, "");

  // 5. Dual-Layer Precision Morphological Anti-Hesitation Sanitizer
  // Targets standalone hesitation phonemes (အာ, ဟာ, အင်း, အင်, အမ်, အာ့) followed by punctuation, ellipses, or spaces
  cleaned = cleaned.replace(/(?:^|\s+)(?:အာ+|ဟာ+|အင်း+|အင်+|အမ်+|အမ်း+|အာ့+)(?:[။\.\,\…\-\–\—\s]*)(?=\s|[။\.\,\…]|$)/g, " ");
  cleaned = cleaned.replace(/^(ဟိုဟာလေ|ဟိုဟာ|အာ့ဆို|အာ့|အင်းး|အင်း|အမ်မ်|အမ်|ဒီဥစ္စာ|အာ)\s*,?\s*/gi, "");
  cleaned = cleaned.replace(/\s*(,\s*nd-sat|,\s*nd\s*sat|,\s*nd)\s*/gi, "");
  cleaned = cleaned.replace(/\b(like|you know)\s*,\s*/gi, "");
  cleaned = cleaned.replace(/\s+(ဟိုဟာလေ|ဟိုဟာ|ဒီဥစ္စာ)\s+/gi, " ");

  // 6. Remove repetitive word stutters
  cleaned = cleaned.replace(/\b(ဒီ|ဟို|အာ)\s+\1\b/gi, "$1");

  // 7. Collapse multi-spaces & clean double punctuation
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/။+/g, "။");
  cleaned = cleaned.replace(/\?+/g, "?");

  // 8. Convert spoken task checklist command ("task: <text>" -> "- [ ] <text>")
  if (/^(task:|တာဝန်:)\s*/i.test(cleaned)) {
    cleaned = cleaned.replace(/^(task:|တာဝန်:)\s*/i, "- [ ] ");
  }

  // 10. Convert spoken code block command ("code: <text>" -> ```\n<text>\n```)
  if (/^(code:|အကုဒ်:)\s*/i.test(cleaned)) {
    const codeBody = cleaned.replace(/^(code:|အကုဒ်:)\s*/i, "").trim();
    cleaned = "```\n" + codeBody + "\n```";
  }

  // 11. Terminal / CLI Punctuation Sanitizer:
  if (activeApp) {
    const lowerApp = activeApp.toLowerCase();
    if (
      lowerApp.includes("terminal") ||
      lowerApp.includes("warp") ||
      lowerApp.includes("iterm") ||
      lowerApp.includes("ghostty") ||
      lowerApp.includes("alacritty")
    ) {
      cleaned = cleaned.replace(/[။\.\?]+$/g, "").trim();
    }
  }

  // 12. Smart English Auto-Capitalization after sentence boundaries (Skip for URLs)
  if (!/^(https?:\/\/|ftp:\/\/|git@)/i.test(cleaned)) {
    cleaned = cleaned.replace(/(^|[။\.\!\?]\s+)([a-z])/g, (_match, prefix, char) => prefix + char.toUpperCase());
  }

  // 13. Fix spacing around Burmese full stop (။)
  cleaned = cleaned.replace(/။([^\s\n])/g, "။ $1");
  cleaned = cleaned.replace(/\s+။/g, "။");

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
  return terms.map(dictionaryEntryFromTerm).filter((entry): entry is DictionaryEntry => Boolean(entry));
}

export function buildDictionaryPromptPart(entries: DictionaryEntry[]): string {
  const active = entries.filter((entry) => entry.enabled && entry.phrase.trim());
  if (active.length === 0) return "";
  const lines = active.map((entry) => {
    const aliases = Array.from(new Set(entry.spokenAliases.filter(Boolean)));
    return `- Possible match: ${aliases.join(" | ")} -> Preferred spelling if supported by the audio: ${entry.phrase}`;
  });
  return `\nDICTIONARY HINTS (soft help only; deterministic local correction runs after transcription):\n${lines.join("\n")}\n`;
}

export function buildCustomVocabularyPromptPart(terms: string[]): string {
  if (!terms || terms.length === 0) return "";

  const mappings: string[] = [];
  const plainTerms: string[] = [];

  for (const raw of terms) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed.includes(" - ")) {
      const [eng, bur] = trimmed.split(" - ").map((s) => s.trim());
      if (eng && bur) {
        mappings.push(`- Spoken sound/name "${eng}" or "${bur}" ➔ Output exact spelling: "${bur}"`);
      }
    } else if (trimmed.includes(" (") && trimmed.endsWith(")")) {
      const bur = trimmed.split(" (")[0]?.trim();
      const eng = trimmed.split(" (")[1]?.slice(0, -1).trim();
      if (bur && eng) {
        mappings.push(`- Spoken sound/name "${bur}" or "${eng}" ➔ Output exact spelling: "${bur}"`);
      }
    } else {
      plainTerms.push(trimmed);
    }
  }

  let result = "\nDICTIONARY HINTS (soft help only; use only when supported by the audio):\n";
  if (mappings.length > 0) {
    result += `POSSIBLE PHONETIC MAPPINGS:\n${mappings.join("\n")}\n`;
  }
  if (plainTerms.length > 0) {
    result += `POSSIBLE TARGET SPELLINGS: ${plainTerms.join(", ")}\n`;
  }
  return result;
}

export interface TranscribeOptions {
  provider?: SpeechProvider;
  geminiModel?: GeminiModelChoice;
  dictationPreset?: DictationPreset;
  translateEnabled?: boolean;
  targetLanguage?: string;
  customVocabulary?: string[];
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>;
  dictionaryEntries?: DictionaryEntry[];
  symbolScannerEnabled?: boolean;
  workspacePath?: string;
  selectedText?: string;
  abortSignal?: AbortSignal;
}

export function getPresetTemperature(preset?: DictationPreset): number {
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
  targetLanguage: string = "English",
  selectedText?: string,
  abortSignal?: AbortSignal
): Promise<{ rawText: string; activeApp: string; usedPaidKey?: boolean }> {
  if (abortSignal?.aborted) {
    throw new Error("Transcription aborted");
  }
  const client = getGeminiClient();
  const base64Audio = audioBuffer.toString("base64");

  const activeApp = getActiveAppName();
  const appContextHint = getAppContextPromptHint(activeApp);

  let appMappings: Record<string, DictationPreset> | undefined;
  let isTranslationActive = translateEnabled ?? false;
  let resolvedTargetLang = targetLanguage;

  try {
    const { loadConfig } = await import("./config.js");
    const cfg = loadConfig();
    appMappings = cfg.appPresetMappings;
    if (translateEnabled === undefined) {
      isTranslationActive = cfg.translateEnabled ?? false;
    }
    if (!targetLanguage || targetLanguage === "English") {
      resolvedTargetLang = cfg.targetLanguage ?? "English";
    }
  } catch {}

  const effectivePreset = resolveEffectivePreset(dictationPreset, activeApp, appMappings);
  const presetHint = getPresetPromptInstructions(effectivePreset);
  const targetTemperature = getPresetTemperature(effectivePreset);

  const diskTerms = loadUserDictionary();
  const presetTerms = presetVocabulary?.[effectivePreset] || [];
  const hintEntries = dictionaryEntries.length > 0
    ? dictionaryEntries
    : migrateLegacyHintEntries([...diskTerms, ...(customVocabulary || []), ...presetTerms]);
  const allCustomTerms = Array.from(new Set([...diskTerms, ...(customVocabulary || []), ...presetTerms].map((term) => term.trim()).filter(Boolean)));

  const dictPromptPart = dictionaryEntries.length > 0
    ? buildDictionaryPromptPart(hintEntries)
    : buildCustomVocabularyPromptPart(allCustomTerms);

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
  let userPromptText = "Transcribe the spoken audio accurately in Burmese script.";

  if (hasSelectedText) {
    sttBasePrompt = `You are an expert AI Dual-Mode Voice Editor and Dictation Assistant. Your task is to analyze the spoken audio together with the provided [SELECTED TEXT].

EVALUATION RULES:
1. ACTION INSTRUCTION: If the spoken audio contains an editing or translation command (e.g. "translate into English", "fix grammar", "make bullet points", "rephrase", "summarize", "make shorter", "rewrite"), apply that command to the [SELECTED TEXT] and return ONLY the modified replacement text.
2. NEW DICTATION: If the spoken audio is new text or dictation content, ignore the [SELECTED TEXT] and return ONLY the clean transcription of the new spoken audio.

OUTPUT FORMAT: Return ONLY the final result text without any quotes, introductory phrases, or explanatory commentary.`;
    userPromptText = `[SELECTED TEXT]:\n"""\n${selectedText?.trim()}\n"""\n\nSPOKEN AUDIO: Listen to the audio. If it's an editing/translation command, transform the selected text. If it's new dictation content, transcribe the new audio directly. Output ONLY the final text.`;
  } else if (isCodePreset) {
    if (isTranslationActive) {
      sttBasePrompt = `You are an expert real-time Speech Translator and Code Specification Architect. Your single imperative task is to listen to the spoken audio and output ONLY its clean, technical translation into ${resolvedTargetLang} with software engineering specification formatting.`;
      userPromptText = `Translate the spoken audio into clear technical specifications in ${resolvedTargetLang}.`;
    } else {
      sttBasePrompt = "You are an expert real-time Speech Dictation and Code Specification Architect. Your single imperative task is to listen to the spoken audio (in Burmese, English, or technical code terms) and transcribe/format it accurately in its original spoken language with syntax-friendly formatting, technical identifier spellings, and inline code comment structure. Preserve the spoken language (Burmese or English) faithfully.";
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
        return { text, usedPaidKey: false };
      };

      const primaryPromise = runPrimary();

      const { getGeminiFallbackClient } = await import("./gemini-client.js");
      const fallbackClient = getGeminiFallbackClient();

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

      // Bulletproof Fallback: If Code preset was requested but response contains Burmese script, run fast text translation
      if (isCodePreset && /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(text)) {
        logger.info({ model, rawTextWithBurmese: text }, "Gemini STT output contained Burmese script in English preset, executing text translation fallback");
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

      logger.info({ model, preferredModel, activeApp, customTermsCount: allCustomTerms.length, dictationPreset, text, byteLength: audioBuffer.length, usedPaidKey: winner.usedPaidKey }, "Gemini STT transcribed successfully");
      return { rawText: text, activeApp, usedPaidKey: winner.usedPaidKey };
    } catch (err: any) {
      logger.warn({ model, preferredModel, err: err?.message || String(err) }, "Model attempt failed, moving to next candidate");
    }
  }

  throw new Error("All Gemini STT models failed to transcribe audio");
}

async function transcribeOpenAI(audioBuffer: Buffer, abortSignal?: AbortSignal): Promise<string> {
  if (abortSignal?.aborted) throw new Error("Transcription aborted");
  const client = getOpenAIClient();

  const file = await toFile(audioBuffer, "recording.webm");
  const transcription = await client.audio.transcriptions.create(
    {
      model: "gpt-4o-mini-transcribe",
      file,
    },
    { signal: abortSignal }
  );

  return transcription.text?.trim() ?? "";
}

let elevenlabsClient: ElevenLabsClient | null = null;

function getElevenLabsClient(): ElevenLabsClient {
  if (elevenlabsClient) return elevenlabsClient;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }
  elevenlabsClient = new ElevenLabsClient({ apiKey });
  return elevenlabsClient;
}

async function transcribeElevenLabs(audioBuffer: Buffer, abortSignal?: AbortSignal): Promise<string> {
  if (abortSignal?.aborted) throw new Error("Transcription aborted");
  const client = getElevenLabsClient();

  const result = await client.speechToText.convert({
    file: {
      data: audioBuffer,
      filename: "recording.webm",
      contentType: "audio/webm",
    },
    modelId: "scribe_v2",
  }, { abortSignal });

  if ("text" in result) {
    return (result.text ?? "").trim();
  }
  if ("transcripts" in result && result.transcripts?.[0]) {
    return (result.transcripts[0].text ?? "").trim();
  }
  return "";
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
  const activeApp = getActiveAppName();

  const provider = typeof providerOrOptions === "string" ? providerOrOptions : (providerOrOptions.provider ?? "gemini");
  const geminiModel = typeof providerOrOptions === "object" ? (providerOrOptions.geminiModel ?? "gemini-3.1-flash-lite") : "gemini-3.1-flash-lite";
  const dictationPreset = typeof providerOrOptions === "object" ? providerOrOptions.dictationPreset : "fast";
  const customVocabulary = typeof providerOrOptions === "object" ? providerOrOptions.customVocabulary : [];
  const presetVocabulary = typeof providerOrOptions === "object" ? providerOrOptions.presetVocabulary : {};
  const symbolScannerEnabled = typeof providerOrOptions === "object" ? providerOrOptions.symbolScannerEnabled ?? true : true;
  const workspacePath = typeof providerOrOptions === "object" ? providerOrOptions.workspacePath : undefined;
  const translateEnabled = typeof providerOrOptions === "object" ? providerOrOptions.translateEnabled : undefined;
  const targetLanguage = typeof providerOrOptions === "object" ? (providerOrOptions.targetLanguage ?? "English") : "English";
  const selectedText = typeof providerOrOptions === "object" ? providerOrOptions.selectedText : undefined;
  const abortSignal = typeof providerOrOptions === "object" ? providerOrOptions.abortSignal : undefined;
  const persistedVocabulary = loadPersistedVocabulary();
  const dictionaryEntries = typeof providerOrOptions === "object" && providerOrOptions.dictionaryEntries !== undefined
    ? providerOrOptions.dictionaryEntries
    : migrateVocabulary(customVocabulary || [], presetVocabulary || {}, persistedVocabulary.entries || [], loadUserDictionary());

  switch (provider) {
    case "local":
      rawText = await transcribeLocal(audioData, abortSignal);
      break;
    case "openai":
      rawText = await transcribeOpenAI(Buffer.from(audioData), abortSignal);
      usedPaidKey = true;
      break;
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

  const effectivePreset = resolveEffectivePreset(dictationPreset, activeApp);
  const sanitized = sanitizeTranscribedText(rawText, activeApp, effectivePreset, dictionaryEntries);
  logger.info({ provider, geminiModel, dictationPreset, effectivePreset, activeApp, rawText, sanitized, usedPaidKey }, "Transcribed detailed and sanitized");
  return { text: sanitized, usedPaidKey, modelUsed: geminiModel };
}

export async function transcribe(
  audioData: ArrayBuffer,
  providerOrOptions: SpeechProvider | TranscribeOptions = "gemini"
): Promise<string> {
  const res = await transcribeDetailed(audioData, providerOrOptions);
  return res.text;
}
