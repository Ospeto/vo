import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { GoogleGenAI } from "@google/genai";
import { loadConfig } from "./config.js";
import logger from "./logger.js";

let geminiClient: GoogleGenAI | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;

export function _resetGeminiClient(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  geminiClient = null;
}

function resolveApiKey(): string | undefined {
  // 1. Prioritize explicit user UI setting in config.json
  try {
    const config = loadConfig();
    if (config.geminiApiKey && config.geminiApiKey.trim() && !config.geminiApiKey.includes("your_")) {
      const trimmedKey = config.geminiApiKey.trim();
      process.env.GEMINI_API_KEY = trimmedKey;
      return trimmedKey;
    }
  } catch {}

  // 2. Process environment variables
  if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes("your_")) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY && !process.env.GOOGLE_API_KEY.includes("your_")) return process.env.GOOGLE_API_KEY;

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
              process.env.GEMINI_API_KEY = key;
              return key;
            }
          }
        }
      }
    } catch {}
  }
  return undefined;
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
  if (geminiClient) return geminiClient;

  const forceVertexOff = process.env.GOOGLE_GENAI_USE_VERTEXAI === "false";
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  const apiKey = resolveApiKey();

  if (project && !forceVertexOff) {
    logger.info({ project, location }, "Initializing Gemini client (Vertex AI)");
    geminiClient = new GoogleGenAI({ vertexai: true, project, location });
  } else if (apiKey) {
    logger.info("Initializing Gemini client (API key, HTTP/2 Keep-Alive Enabled)");
    geminiClient = new GoogleGenAI({ apiKey, httpOptions: { headers: { Connection: "keep-alive" } } });
    startKeepAliveHeartbeat(geminiClient);
  } else {
    throw new Error(
      "Gemini provider requires either GOOGLE_CLOUD_PROJECT (for Vertex AI) " +
        "or GEMINI_API_KEY / GOOGLE_API_KEY (for Gemini API).",
    );
  }

  return geminiClient;
}
