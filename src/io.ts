import { extname, resolve } from 'node:path';
import { readEnvVar, parseBoolEnv, expandPath, writeUniqueFile } from '@chrischall/mcp-utils';

/**
 * Where generated files go.
 *
 * Split behind an interface because the answer differs by deployment. Over
 * stdio the user's own filesystem is right there, and returning a path is the
 * most useful thing a tool can do. Hosted (mcp-host / claude.ai) the filesystem
 * belongs to a Fly machine the user cannot reach, so a tool that reports
 * `wrote /data/x.png` has told them nothing they can act on — there, bytes must
 * come back inline instead.
 *
 * `persistsFiles` is what lets a tool tell the two apart rather than assuming.
 */
export interface FileIO {
  /** True when a written path is something the caller can actually open. */
  readonly persistsFiles: boolean;
  readonly outputDir: string;
  write(name: string, bytes: Buffer): Promise<string>;
}

/** Upper bound on collision-fallback names tried before giving up. */
const MAX_NAME_ATTEMPTS = 100;

export class DiskFileIO implements FileIO {
  readonly persistsFiles = true;
  readonly outputDir: string;

  constructor(outputDir?: string) {
    // Resolved here but created lazily on first write (not mcp-utils'
    // resolveOutputDir, which mkdirs eagerly): a bad ACCESSO_OUTPUT_DIR should
    // fail the save tool, not server start-up.
    const configured = outputDir ?? readEnvVar('ACCESSO_OUTPUT_DIR');
    this.outputDir = configured ? resolve(expandPath(configured)) : resolve(process.cwd());
  }

  async write(name: string, bytes: Buffer): Promise<string> {
    // Never clobber: barcodes are the thing the user shows at the gate. On a
    // collision, write under a fresh name (`a-2.png`, …) and return THAT path —
    // the caller reports it, and pointing at the old file would show a stale
    // barcode. writeUniqueFile claims each name with an exclusive, no-follow
    // create (race-free; a symlink planted at a name is skipped, never written
    // through) and flattens the stem to one path component, so a `/` or `..`
    // in the scraped order number can't steer the write out of outputDir.
    const ext = extname(name);
    return writeUniqueFile({
      dir: this.outputDir,
      baseName: ext ? name.slice(0, -ext.length) : name,
      extension: ext ? ext.slice(1) : 'bin',
      bytes,
      maxAttempts: MAX_NAME_ATTEMPTS,
    });
  }
}

/** Discards bytes; used when only inline output is meaningful. */
export class NoFileIO implements FileIO {
  readonly persistsFiles = false;
  readonly outputDir = '';
  async write(name: string): Promise<string> {
    return name;
  }
}

export function defaultFileIO(): FileIO {
  // A real boolean, not "any value": ACCESSO_NO_FILE_OUTPUT=0/false/no/off
  // means "do write files", and must not silently switch saves to inline.
  return parseBoolEnv('ACCESSO_NO_FILE_OUTPUT') ? new NoFileIO() : new DiskFileIO();
}
