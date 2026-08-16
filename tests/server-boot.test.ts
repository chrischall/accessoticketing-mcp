import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Boots the REAL built artifacts and runs an `initialize` + `tools/list`
 * handshake.
 *
 * The unit suite mocks the transport, so it can never catch the two failures
 * that only exist in a built artifact: a `bin` pointing at a path tsc did not
 * emit, and an eager import of a dependency the .mcpb bundle does not ship
 * (which crashes at load, before the server answers `initialize`, and surfaces
 * to a host only as "server transport closed unexpectedly").
 */
async function handshake(entry: string, cwd: string): Promise<string[]> {
  const child = spawn(process.execPath, [entry], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // No credentials configured on purpose: the server must still boot and answer the
    // host's install-time probe. That is the deferred-config-error contract.
    env: { ...process.env, ACCESSO_TICKET_URL: '' },
  });

  let done = false;
  // Once the child is killed its stdin is gone; a late stdout chunk would
  // otherwise trigger a write and raise EPIPE after the test has passed.
  const send = (msg: unknown) => {
    if (done || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify(msg)}\n`, () => undefined);
  };
  child.stdin.on('error', () => undefined);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'boot-test', version: '0' },
  } });

  let out = '';
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

  const names = await new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out. stderr: ${stderr.slice(0, 600)}`));
    }, 20_000);

    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        let msg: { id?: number; result?: { tools?: { name: string }[] } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
        }
        if (msg.id === 2 && msg.result?.tools) {
          done = true;
          clearTimeout(timer);
          child.kill();
          resolve(msg.result.tools.map((t) => t.name));
        }
      }
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (done) return;
      clearTimeout(timer);
      reject(new Error(`exited early (code ${code}). stderr: ${stderr.slice(0, 600)}`));
    });
  });

  return names;
}

describe('server boot', () => {
  it('the bin entry starts and lists tools', async () => {
    const entry = join(root, 'dist', 'index.js');
    expect(existsSync(entry), 'run `npm run build` first').toBe(true);
    const names = await handshake(entry, root);
    // A floor, not an exact count: PR CI runs the branch merged with main, so
    // an exact assertion breaks the moment another PR adds a tool.
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names).toContain('accesso_healthcheck');
  }, 30_000);

  it('the bundle runs with no node_modules, as the .mcpb does', async () => {
    const bundle = join(root, 'dist', 'bundle.js');
    expect(existsSync(bundle), 'run `npm run build` first').toBe(true);

    // A bare directory: no node_modules at all, so any dependency the bundle
    // failed to inline is a load-time crash rather than a silent pass.
    const dir = mkdtempSync(join(tmpdir(), 'accessoticketing-mcpb-'));
    copyFileSync(bundle, join(dir, 'bundle.js'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));

    const names = await handshake(join(dir, 'bundle.js'), dir);
    // node-html-parser must have been inlined by esbuild; an eager import of
    // something the bundle did not ship crashes at load, before `initialize`.
    expect(names).toContain('accesso_get_order');
  }, 30_000);
});
