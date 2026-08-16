import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { versionSyncTest } from '@chrischall/mcp-utils/test';
import { VERSION } from '../src/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>;

describe('version sync', () => {
  it('keeps every release-please-marked literal in sync with package.json', () => {
    expect(versionSyncTest({ srcDir: join(root, 'src'), pkgPath: join(root, 'package.json') })).toEqual([]);
  });

  it('reports the packaged version at runtime', () => {
    expect(VERSION).toBe(pkg['version']);
  });

  // release-please rewrites these through `extra-files`; one missing from that
  // list drifts silently until a release PR fails CI.
  it.each([
    ['manifest.json', (j: any) => j.version],
    ['server.json', (j: any) => j.version],
    ['server.json', (j: any) => j.packages[0].version],
    ['.claude-plugin/plugin.json', (j: any) => j.version],
    ['.claude-plugin/marketplace.json', (j: any) => j.metadata.version],
    ['.claude-plugin/marketplace.json', (j: any) => j.plugins[0].version],
  ])('%s carries the package version', (file, pick) => {
    expect(pick(JSON.parse(readFileSync(join(root, file), 'utf8')))).toBe(pkg['version']);
  });
});

describe('packaging', () => {
  // npm rejects a --provenance publish whose repository.url does not match the
  // sigstore bundle, and it fails AFTER release-please has tagged — so the
  // release looks green while npm never moves.
  it('declares the repository provenance requires', () => {
    expect(pkg['repository']).toEqual({
      type: 'git',
      url: 'git+https://github.com/chrischall/accessoticketing-mcp.git',
    });
  });

  it('publishes under the @chrischall scope with public access', () => {
    expect(pkg['name']).toBe('@chrischall/accessoticketing-mcp');
    expect((pkg['publishConfig'] as Record<string, unknown>)['access']).toBe('public');
  });

  // Without "skills" in files, the shell-out skill silently does not ship.
  it('ships the skills directory on npm', () => {
    expect(pkg['files']).toContain('skills');
  });

  it('keeps the server.json description within the registry limit', () => {
    const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as { description: string };
    expect(server.description.length).toBeLessThanOrEqual(100); // mcp-publisher 422s above 100
  });

  it('points the plugin at the skills directory so skills are auto-discovered', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')) as {
      skills: string;
    };
    expect(plugin.skills).toBe('./skills/');
  });
});
