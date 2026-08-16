import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskFileIO, NoFileIO, defaultFileIO } from '../src/io.js';

const bytes = Buffer.from([1, 2, 3]);

describe('DiskFileIO', () => {
  it('writes into the configured directory and reports a usable path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-io-'));
    const io = new DiskFileIO(dir);
    expect(io.persistsFiles).toBe(true);
    const path = await io.write('a.png', bytes);
    expect(path).toBe(join(dir, 'a.png'));
    expect(readFileSync(path)).toEqual(bytes);
  });

  it('never clobbers an existing barcode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-io-'));
    const io = new DiskFileIO(dir);
    await io.write('a.png', bytes);
    await io.write('a.png', Buffer.from([9]));
    const files = readdirSync(dir);
    expect(files).toHaveLength(2);
    expect(readFileSync(join(dir, 'a.png'))).toEqual(bytes);
  });

  it('reads ACCESSO_OUTPUT_DIR when no directory is passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-io-'));
    vi.stubEnv('ACCESSO_OUTPUT_DIR', dir);
    expect(new DiskFileIO().outputDir).toBe(dir);
  });

  it('falls back to the working directory', () => {
    expect(new DiskFileIO().outputDir).toBe(process.cwd());
  });

  it('propagates a write failure that is not a name collision', async () => {
    // A name pointing into a directory that does not exist fails ENOENT, not
    // EEXIST — the collision fallback must not swallow it.
    const io = new DiskFileIO(mkdtempSync(join(tmpdir(), 'accesso-io-')));
    await expect(io.write('missing-dir/a.png', bytes)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('NoFileIO', () => {
  it('declares that its paths are not real, so tools can inline instead', async () => {
    const io = new NoFileIO();
    expect(io.persistsFiles).toBe(false);
    expect(io.outputDir).toBe('');
    expect(await io.write('a.png', bytes)).toBe('a.png');
  });
});

describe('defaultFileIO', () => {
  it('writes to disk by default', () => {
    expect(defaultFileIO().persistsFiles).toBe(true);
  });

  it('honours ACCESSO_NO_FILE_OUTPUT for deployments with no reachable filesystem', () => {
    vi.stubEnv('ACCESSO_NO_FILE_OUTPUT', '1');
    expect(defaultFileIO().persistsFiles).toBe(false);
  });
});
