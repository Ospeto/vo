import OpenAI, { toFile } from "openai";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync, exec } from "node:child_process";
import type { SpeechProvider, GeminiModelChoice, DictationPreset } from "./config.js";
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
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to pre-warm Gemini client connection");
  }
}

let cachedActiveAppName = "Unknown";
let lastActiveAppTime = 0;
let isRefreshingApp = false;

function refreshActiveAppNameAsync(): void {
  if (isRefreshingApp) return;
  isRefreshingApp = true;
  try {
    exec(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
      { encoding: "utf-8", timeout: 600 },
      (err, stdout) => {
        isRefreshingApp = false;
        if (!err && stdout) {
          const appName = stdout.trim();
          if (appName) {
            cachedActiveAppName = appName;
            lastActiveAppTime = Date.now();
          }
        }
      }
    );
  } catch {
    isRefreshingApp = false;
  }
}

export function getActiveAppName(): string {
  const now = Date.now();
  if (cachedActiveAppName !== "Unknown") {
    if (now - lastActiveAppTime > 3000) {
      refreshActiveAppNameAsync();
    }
    return cachedActiveAppName;
  }

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

export function resolveEffectivePreset(preset?: DictationPreset, appName?: string): DictationPreset {
  if (preset !== "auto") return preset ?? "fast";
  if (!appName) return "fast";

  const lower = appName.toLowerCase();
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

  return "fast";
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
    case "email_polish":
      return `${GLOBAL_BILINGUAL_DIRECTIVE}\n\nPreset Mode: EMAIL POLISH. Format the output as a clean, professional, grammatically polished email message with clear paragraphing while preserving natural bilingual technical terms in English.`;
    case "burmese_written":
      return `${GLOBAL_BILINGUAL_DIRECTIVE}\n\nPreset Mode: BURMESE WRITTEN. Format spoken Burmese into formal, polished Burmese literary/written prose (မြန်မာစာအရေးအသား) while preserving English technical terms and code identifiers in pure English.`;
    case "translate_en":
      return "\nPreset Mode: TRANSLATE TO ENGLISH. Hear the spoken Burmese audio and directly output its accurate, fluent, natural English translation. Output ONLY the English text without any Burmese script, intros, or wrapping quotes.";
    case "careful":
      return `
${GLOBAL_BILINGUAL_DIRECTIVE}

Preset Mode: CAREFUL DEEP PROOFREADING & SEMANTIC REASONING.
Analyze the spoken audio meticulously. Perform deep proofreading to correct phonetically garbled words, homophones, awkward phrasing, and speech slips. Format the output into highly coherent, grammatically flawless, natural text while strictly preserving 100% of the speaker's core intent, meaning, and technical terminology. Output ONLY the proofread final text.
`.trim();
    case "fast":
    case "auto":
    default:
      return GLOBAL_BILINGUAL_DIRECTIVE;
  }
}

export function sanitizeTranscribedText(text: string, activeApp?: string, preset?: DictationPreset): string {
  if (!text) return "";

  const effectivePreset = resolveEffectivePreset(preset, activeApp);
  let cleaned = text.trim();

  // Filter out unwanted Burmese raw text lines or inline Burmese script when using code_comment or translate_en presets
  if (effectivePreset === "code_comment" || effectivePreset === "translate_en") {
    const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const nonBurmeseLines = lines.filter((l) => !/[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(l));
      if (nonBurmeseLines.length > 0) {
        cleaned = nonBurmeseLines.join(" ");
      } else {
        cleaned = lines[lines.length - 1];
      }
    }
    // Purge any trailing or inline Burmese characters for code_comment or translate_en presets
    cleaned = cleaned.replace(/[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]+/g, " ").replace(/\s+/g, " ").trim();
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

  // 8. Standardize Burmese course & project names to English script
  cleaned = cleaned.replace(/မက်စ်\s*၁၄၁/gi, "MAS 141");
  cleaned = cleaned.replace(/မက်စ်\s*၁၄၂/gi, "MAS 142");
  cleaned = cleaned.replace(/မက်စ်\s*၁၄၃/gi, "MAS 143");
  cleaned = cleaned.replace(/(စာရေးကောင်း|စာရေး\s*ကောင်း|စာရေးကောင်)/gi, "SarYayKaung");
  cleaned = cleaned.replace(/(ဩစပေတို|အိုစပေတို)/gi, "Ospeto");
  cleaned = cleaned.replace(/(တီဘီအိတ်ချ်|တီဘီအိတ်)/gi, "TBH");
  cleaned = cleaned.replace(/(အင်ဂရမ်|အန်ဂရမ်)/gi, "Engram");

  // 9. Convert spoken task checklist command ("task: <text>" -> "- [ ] <text>")
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

  // 12. Smart English Auto-Capitalization after sentence boundaries
  cleaned = cleaned.replace(/(^|[။\.\!\?]\s+)([a-z])/g, (_match, prefix, char) => prefix + char.toUpperCase());

  // 13. Fix spacing around Burmese full stop (။)
  cleaned = cleaned.replace(/။([^\s\n])/g, "။ $1");
  cleaned = cleaned.replace(/\s+။/g, "။");

  return cleaned.trim();
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
2. Only write standard English technical/project terms in English script (e.g. SarYayKaung, Ospeto, TBH, Engram, MAS 141, MAS 142, MAS 143, FSRS, SQL, Python, VPN).
3. Transcribe only what was actually spoken. Do NOT hallucinate lists of vocabulary words. No intro or markdown wrappers.
`.trim();

export interface TranscribeOptions {
  provider?: SpeechProvider;
  geminiModel?: GeminiModelChoice;
  dictationPreset?: DictationPreset;
  customVocabulary?: string[];
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>;
  symbolScannerEnabled?: boolean;
  workspacePath?: string;
}

export function getPresetTemperature(preset?: DictationPreset): number {
  switch (preset) {
    case "email_polish":
      return 0.1;
    case "burmese_written":
      return 0.15;
    case "fast":
    case "code_comment":
    case "translate_en":
    default:
      return 0.0;
  }
}

export function getFallbackModelChain(
  preferredModel: GeminiModelChoice,
  effectivePreset?: DictationPreset
): string[] {
  let fallbackCandidates: string[];
  if (effectivePreset === "code_comment" || effectivePreset === "careful") {
    // For code & careful presets: try 3.6-flash, 3.1-flash-lite, 3.5-flash-lite, 2.5-flash, 2.5-pro
    fallbackCandidates = ["gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
  } else {
    // For general presets: default fallback is 3.1-flash-lite / 3.5-flash-lite (exclude expensive 3.6-flash)
    fallbackCandidates = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];
  }

  const filtered = fallbackCandidates.filter((m) => m !== preferredModel);
  return Array.from(new Set([preferredModel, ...filtered]));
}

async function transcribeGemini(
  audioBuffer: Buffer,
  preferredModel: GeminiModelChoice = "gemini-3.1-flash-lite",
  dictationPreset?: DictationPreset,
  customVocabulary?: string[],
  presetVocabulary?: Partial<Record<DictationPreset, string[]>>,
  symbolScannerEnabled: boolean = true,
  workspacePath?: string
): Promise<{ rawText: string; activeApp: string }> {
  const client = getGeminiClient();
  const base64Audio = audioBuffer.toString("base64");

  const activeApp = getActiveAppName();
  const appContextHint = getAppContextPromptHint(activeApp);

  const effectivePreset = resolveEffectivePreset(dictationPreset, activeApp);
  const presetHint = getPresetPromptInstructions(effectivePreset);
  const targetTemperature = getPresetTemperature(effectivePreset);

  const diskTerms = loadUserDictionary();
  const presetTerms = presetVocabulary?.[effectivePreset] || [];
  const allCustomTerms = Array.from(new Set([...diskTerms, ...(customVocabulary || []), ...presetTerms]))
    .map((t) => t.trim().slice(0, 40))
    .filter((t) => t.length > 0)
    .slice(0, 50);

  const dictPromptPart = allCustomTerms.length > 0
    ? `\nKey Terms: ${allCustomTerms.join(", ")}\n`
    : "";

  let workspacePromptPart = "";
  if (symbolScannerEnabled !== false) {
    const targetDir = workspacePath || process.cwd();
    const scan = scanWorkspaceSymbols(targetDir);
    if (scan.symbols.length > 0 || scan.fileNames.length > 0) {
      workspacePromptPart = `\nActive Workspace Identifiers (${scan.workspaceName}): ${scan.symbols.join(", ")}\nFiles: ${scan.fileNames.join(", ")}\n`;
    }
  }

  const isEnglishPreset = effectivePreset === "code_comment" || effectivePreset === "translate_en";
  const sttBasePrompt = isEnglishPreset
    ? "You are an expert real-time Burmese-to-English Speech Translator and Code Specification Architect. Your single imperative task is to listen to the spoken Burmese audio and output ONLY its clean, precise, technical English translation/specification. NEVER output Burmese script in the response."
    : BURMESE_ACCURATE_STT_PROMPT;

  const fullPrompt = `${sttBasePrompt}\n${appContextHint}${workspacePromptPart}${dictPromptPart}${presetHint}`;
  const userPromptText = isEnglishPreset
    ? "Translate the spoken audio into clear, technical English software engineering specifications. Output ONLY pure English text. Under NO circumstances should any Burmese script be included in the response."
    : "Transcribe the spoken audio accurately in Burmese script.";

  // Dynamically scale timeout from 6s to 20s based on audio payload byte length
  const dynamicTimeoutMs = Math.max(6000, Math.min(20000, Math.ceil(audioBuffer.length / 8)));

  // Model fallback chain: preferred model first, 3.6-flash ONLY allowed for code_comment preset
  const modelsToTry = getFallbackModelChain(preferredModel, effectivePreset);

  for (const model of modelsToTry) {
    try {
      const fetchPromise = client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "audio/webm",
                  data: base64Audio,
                },
              },
              {
                text: userPromptText,
              },
            ],
          },
        ],
        config: {
          systemInstruction: fullPrompt,
          temperature: targetTemperature,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Model ${model} timed out after ${dynamicTimeoutMs}ms`)), dynamicTimeoutMs);
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      let text = response.text?.trim() ?? "";

      // Bulletproof Fallback: If English preset was requested but response contains Burmese script, run fast text translation
      if (isEnglishPreset && /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/.test(text)) {
        logger.info({ model, rawTextWithBurmese: text }, "Gemini STT output contained Burmese script in English preset, executing text translation fallback");
        try {
          const translateRes = await client.models.generateContent({
            model: "gemini-3.5-flash-lite",
            contents: `You are a Senior Software Engineer. Translate the following Burmese dictation into a clean, precise English technical specification for an AI coding assistant. Output ONLY pure English text without any Burmese script:\n\n${text}`,
            config: {
              temperature: 0.0,
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

      logger.info({ model, preferredModel, activeApp, customTermsCount: allCustomTerms.length, dictationPreset, text, byteLength: audioBuffer.length, dynamicTimeoutMs }, "Gemini STT transcribed successfully");
      return { rawText: text, activeApp };
    } catch (err: any) {
      logger.warn({ model, preferredModel, err: err?.message || String(err) }, "Failed Gemini model transcription, trying next");
    }
  }

  throw new Error("All Gemini STT models failed to transcribe audio");
}

async function transcribeOpenAI(audioBuffer: Buffer): Promise<string> {
  const client = getOpenAIClient();

  const file = await toFile(audioBuffer, "recording.webm");
  const transcription = await client.audio.transcriptions.create({
    model: "gpt-4o-mini-transcribe",
    file,
  });

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

async function transcribeElevenLabs(audioBuffer: Buffer): Promise<string> {
  const client = getElevenLabsClient();

  const result = await client.speechToText.convert({
    file: {
      data: audioBuffer,
      filename: "recording.webm",
      contentType: "audio/webm",
    },
    modelId: "scribe_v2",
  });

  if ("text" in result) {
    return (result.text ?? "").trim();
  }
  if ("transcripts" in result && result.transcripts?.[0]) {
    return (result.transcripts[0].text ?? "").trim();
  }
  return "";
}

async function transcribeLocal(audioData: ArrayBuffer): Promise<string> {
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

export async function transcribe(
  audioData: ArrayBuffer,
  providerOrOptions: SpeechProvider | TranscribeOptions = "gemini",
): Promise<string> {
  let rawText = "";
  const activeApp = getActiveAppName();

  const provider = typeof providerOrOptions === "string" ? providerOrOptions : (providerOrOptions.provider ?? "gemini");
  const geminiModel = typeof providerOrOptions === "object" ? (providerOrOptions.geminiModel ?? "gemini-3.1-flash-lite") : "gemini-3.1-flash-lite";
  const dictationPreset = typeof providerOrOptions === "object" ? providerOrOptions.dictationPreset : "fast";
  const customVocabulary = typeof providerOrOptions === "object" ? providerOrOptions.customVocabulary : [];
  const presetVocabulary = typeof providerOrOptions === "object" ? providerOrOptions.presetVocabulary : {};
  const symbolScannerEnabled = typeof providerOrOptions === "object" ? providerOrOptions.symbolScannerEnabled ?? true : true;
  const workspacePath = typeof providerOrOptions === "object" ? providerOrOptions.workspacePath : undefined;

  switch (provider) {
    case "local":
      rawText = await transcribeLocal(audioData);
      break;
    case "openai":
      rawText = await transcribeOpenAI(Buffer.from(audioData));
      break;
    case "elevenlabs":
      rawText = await transcribeElevenLabs(Buffer.from(audioData));
      break;
    case "gemini":
    default: {
      const res = await transcribeGemini(Buffer.from(audioData), geminiModel, dictationPreset, customVocabulary, presetVocabulary, symbolScannerEnabled, workspacePath);
      rawText = res.rawText;
      break;
    }
  }

  const effectivePreset = resolveEffectivePreset(dictationPreset, activeApp);
  const sanitized = sanitizeTranscribedText(rawText, activeApp, effectivePreset);
  logger.info({ provider, geminiModel, dictationPreset, effectivePreset, activeApp, rawText, sanitized }, "Transcribed and sanitized");
  return sanitized;
}
