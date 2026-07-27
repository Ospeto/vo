import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { GoogleGenAI } from "@google/genai";
import { loadConfig } from "./config.js";
import logger from "./logger.js";

let geminiClients: GoogleGenAI[] = [];
let currentKeyIndex = 0;
let keepAliveTimer: NodeJS.Timeout | null = null;

export function _resetGeminiClient(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  geminiClients = [];
  currentKeyIndex = 0;
}

export function resolveApiKeys(): string[] {
  let rawKeysString: string | undefined;

  // 1. Prioritize explicit user UI setting in config.json
  try {
    const config = loadConfig();
    if (config.geminiApiKey && config.geminiApiKey.trim() && !config.geminiApiKey.includes("your_")) {
      rawKeysString = config.geminiApiKey.trim();
    }
  } catch {}

  // 2. Process environment variables if no config key
  if (!rawKeysString) {
    if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes("your_")) {
      rawKeysString = process.env.GEMINI_API_KEY;
    } else if (process.env.GOOGLE_API_KEY && !process.env.GOOGLE_API_KEY.includes("your_")) {
      rawKeysString = process.env.GOOGLE_API_KEY;
    }
  }

  // 3. Fallback to .env files
  if (!rawKeysString) {
    const candidateEnvPaths = [
      join(homedir(), ".config", "pi-voice", ".env"),
      join(process.cwd(), ".env"),
      join(homedir(), ".hermes", ".env"),
      join(homedir(), ".env"),
    ];

    for (const envPath of candidateEnvPaths) {
      try {
        if (existsSync(envPath)) {
          const content = readFileSync(envPath, "utf-8");
          const lines = content.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("#")) continue;
            const match = trimmed.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY)=(.+)/);
            if (match && match[1]) {
              const key = match[1].trim().replace(/^["']|["']$/g, "").split("#")[0].trim();
              if (key && !key.includes("your_") && !key.includes("your_gemini_key_here")) {
                rawKeysString = key;
                break;
              }
            }
          }
        }
      } catch {}
      if (rawKeysString) break;
    }
  }

  if (!rawKeysString) return [];

  // Split comma or newline separated keys
  const keys = rawKeysString
    .split(/[,\n]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !k.includes("your_"));

  if (keys.length > 0) {
    process.env.GEMINI_API_KEY = keys[0];
  }

  return keys;
}

function startKeepAliveHeartbeat(client: GoogleGenAI) {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    try {
      client.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        config: { maxOutputTokens: 1 },
      }).catch(() => {});
    } catch {}
  }, 45000);
}

export function getGeminiClient(): GoogleGenAI {
  if (geminiClients.length > 0) {
    const client = geminiClients[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % geminiClients.length;
    return client;
  }

  const forceVertexOff = process.env.GOOGLE_GENAI_USE_VERTEXAI === "false";
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  const apiKeys = resolveApiKeys();

  if (project && !forceVertexOff) {
    logger.info({ project, location }, "Initializing Gemini client (Vertex AI)");
    const client = new GoogleGenAI({ vertexai: true, project, location });
    geminiClients = [client];
  } else if (apiKeys.length > 0) {
    logger.info({ keyCount: apiKeys.length }, "Initializing Gemini client(s) (Multi-Key Round-Robin Active)");
    geminiClients = apiKeys.map(
      (apiKey) => new GoogleGenAI({ apiKey, httpOptions: { headers: { Connection: "keep-alive" } } }),
    );
    if (geminiClients.length > 0) {
      startKeepAliveHeartbeat(geminiClients[0]);
    }
  } else {
    throw new Error(
      "Gemini provider requires either GOOGLE_CLOUD_PROJECT (for Vertex AI) " +
        "or GEMINI_API_KEY / GOOGLE_API_KEY (for Gemini API).",
    );
  }

  const client = geminiClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % geminiClients.length;
  return client;
}
