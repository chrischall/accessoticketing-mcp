import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readEnvVar, expandPath } from '@chrischall/mcp-utils';

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
    const configured = outputDir ?? readEnvVar('ACCESSO_OUTPUT_DIR');
    this.outputDir = configured ? resolve(expandPath(configured)) : resolve(process.cwd());
  }

  async write(name: string, bytes: Buffer): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });
    // Never clobber: barcodes are the thing the user shows at the gate. On a
    // collision, write under a fresh name and return THAT path — the caller
    // reports it, and pointing at the old file would show a stale barcode.
    const stamp = Date.now();
    for (let attempt = 0; ; attempt++) {
      const candidate =
        attempt === 0 ? name : `${stamp}${attempt > 1 ? `-${attempt - 1}` : ''}-${name}`;
      const path = join(this.outputDir, candidate);
      try {
        await writeFile(path, bytes, { flag: 'wx' });
        return path;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= MAX_NAME_ATTEMPTS) throw err;
      }
    }
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
  return readEnvVar('ACCESSO_NO_FILE_OUTPUT') ? new NoFileIO() : new DiskFileIO();
}
