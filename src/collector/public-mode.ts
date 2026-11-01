import type { IndexFile } from "../types.js";
import type { Config } from "./config.js";

export interface PublicModeViolation {
  /** Summary reason category. */
  reason: "config" | "public_private_data";
  message: string;
}

export const PUBLIC_MODE_NO_EFFECT = "public_mode has no effect in a private repository.";

/**
 * Guards for a public Traffolio repository running with `public_mode: true`, checked before
 * anything is collected or written. Everything here ends up public, so no private repository
 * may be selected, and stored data about one (from an earlier private life of this repository)
 * would already be exposed: refuse rather than add to it.
 */
export function checkPublicMode(config: Config, prevIndex: IndexFile | undefined): PublicModeViolation | undefined {
  if (config.repositories.include_private) {
    return {
      reason: "config",
      message: "Stopped (config); nothing written. ConfigError: include_private cannot be used with public_mode.",
    };
  }
  if (Object.values(prevIndex?.repositories ?? {}).some((entry) => entry.private === true)) {
    return {
      reason: "public_private_data",
      message:
        "Stopped (public_private_data): this public repository already contains data about private repositories; " +
        "nothing was written — start from a clean repository.",
    };
  }
  return undefined;
}
