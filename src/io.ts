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

export class DiskFileIO implements FileIO {
  readonly persistsFiles = true;
  readonly outputDir: string;

  constructor(outputDir?: string) {
    const configured = outputDir ?? readEnvVar('ACCESSO_OUTPUT_DIR');
    this.outputDir = configured ? resolve(expandPath(configured)) : resolve(process.cwd());
  }

  async write(name: string, bytes: Buffer): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });
    const path = join(this.outputDir, name);
    // Never clobber: barcodes are the thing the user shows at the gate.
    await writeFile(path, bytes, { flag: 'wx' }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
      await writeFile(join(this.outputDir, `${Date.now()}-${name}`), bytes);
    });
    return path;
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
