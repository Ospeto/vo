/**
 * Centralized pino logger for the pi-voice daemon with automatic log rotation.
 *
 * Outputs to both the console (stdout) and a log file simultaneously
 * using pino.multistream.
 *
 * Log file location (in order of precedence):
 *   1. PI_VOICE_LOG_PATH environment variable
 *   2. $XDG_CONFIG_HOME/pi-voice/daemon.log  (if XDG_CONFIG_HOME is set)
 *   3. ~/.config/pi-voice/daemon.log          (default)
 */

import { existsSync, statSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import pino from "pino";

function resolveLogPath(): string {
  const envPath = process.env["PI_VOICE_LOG_PATH"];
  if (envPath) return envPath;

  const configHome =
    process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
  return join(configHome, "pi-voice", "daemon.log");
}

function rotateLogIfNeeded(logFile: string): void {
  try {
    if (!existsSync(logFile)) return;
    const stats = statSync(logFile);
    // 2MB threshold for auto-archiving log files
    if (stats.size > 2 * 1024 * 1024) {
      const dir = dirname(logFile);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = join(dir, `daemon-${timestamp}.log`);
      renameSync(logFile, archivePath);

      // Prune old archives, keeping only the 3 most recent archived log files
      const files = readdirSync(dir)
        .filter((f) => f.startsWith("daemon-") && f.endsWith(".log"))
        .sort();

      while (files.length > 3) {
        const oldest = files.shift();
        if (oldest) {
          try {
            unlinkSync(join(dir, oldest));
          } catch {}
        }
      }
    }
  } catch {}
}

let fileLoggingActive = false;

function createPinoLogger(): pino.Logger {
  const logPath = resolveLogPath();
  rotateLogIfNeeded(logPath);

  let fileStream: pino.DestinationStream | null = null;
  try {
    fileStream = pino.destination({ dest: logPath, mkdir: true, sync: true });
    fileLoggingActive = true;
  } catch (err: any) {
    fileLoggingActive = false;
    try {
      process.stderr.write(
        `[logger] Warning: Failed to initialize file logger at "${logPath}": ${err?.message || String(err)}. Falling back to stderr logging.\n`
      );
    } catch {
      // Ignore stderr write errors
    }
  }

  const streams: pino.StreamEntry[] = fileLoggingActive && fileStream
    ? [
        { level: "debug", stream: process.stdout },
        { level: "debug", stream: fileStream },
      ]
    : [
        { level: "debug", stream: process.stderr },
      ];

  return pino({ level: "debug" }, pino.multistream(streams));
}

const logger = createPinoLogger();

export default logger;

/**
 * Return the resolved log file path (useful for status/diagnostics).
 */
export function getLogPath(): string {
  return resolveLogPath();
}

/**
 * Return whether file logging successfully initialized.
 */
export function isFileLoggingActive(): boolean {
  return fileLoggingActive;
}
