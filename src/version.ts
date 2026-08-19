/**
 * Single source of truth for the server's self-reported version.
 *
 * The literal on the VERSION line below is rewritten by release-please (the
 * file is registered under `extra-files` in `release-please-config.json`).
 * Everything that needs a version imports this constant, so there is exactly
 * one line to keep in sync and `versionSyncTest` has exactly one to check.
 */
export const VERSION = '0.1.1'; // x-release-please-version
