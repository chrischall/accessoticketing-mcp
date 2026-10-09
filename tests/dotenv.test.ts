import { describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const loadDotenvSafely = vi.fn(async () => false);
vi.mock('@chrischall/mcp-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@chrischall/mcp-utils')>()),
  loadDotenvSafely,
}));

describe('.env loading', () => {
  it('loads the package .env (never overriding host env) before the client reads its config', async () => {
    // dotenv was a runtime dependency that nothing called, so the documented
    // .env (see .env.example) was never read.
    await import('../src/client.js');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    expect(loadDotenvSafely).toHaveBeenCalledWith({ path: join(root, '.env'), override: false });
  });
});
