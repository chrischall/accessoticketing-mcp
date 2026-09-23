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

  it('reports the path it actually wrote when the name was already taken', async () => {
    // Regression (fleet-audit#24): the collision fallback wrote the new bytes
    // to a timestamped file but returned the OLD path, so a re-saved (reissued)
    // barcode was reported as the stale image.
    const dir = mkdtempSync(join(tmpdir(), 'accesso-io-'));
    const io = new DiskFileIO(dir);
    const first = await io.write('a.png', bytes);
    const fresh = Buffer.from([9]);
    const second = await io.write('a.png', fresh);
    expect(second).not.toBe(first);
    expect(readFileSync(second)).toEqual(fresh);
    expect(readFileSync(first)).toEqual(bytes);
  });

  it('never clobbers a fallback name either, even within the same millisecond', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-io-'));
    const io = new DiskFileIO(dir);
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    try {
      const paths = [];
      for (let i = 0; i < 4; i++) paths.push(await io.write('a.png', Buffer.from([i])));
      expect(new Set(paths).size).toBe(4);
      paths.forEach((p, i) => expect(readFileSync(p)).toEqual(Buffer.from([i])));
      expect(readdirSync(dir)).toHaveLength(4);
    } finally {
      vi.restoreAllMocks();
    }
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
