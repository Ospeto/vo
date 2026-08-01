import { existsSync, statSync, chmodSync } from "node:fs";

/**
 * Ensures a file has owner-only 0600 (read/write by owner only) permissions.
 * Safely repairs permissions on existing files without modifying content or truncating.
 */
export function ensureOwnerOnlyPermissions(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      const currentMode = statSync(filePath).mode & 0o777;
      if (currentMode !== 0o600) {
        chmodSync(filePath, 0o600);
      }
    }
  } catch {}
}
