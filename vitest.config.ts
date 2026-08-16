import { defineConfig } from 'vitest/config';

// Coverage-enforced: `npm run test:coverage` (wired into CI) fails the
// build on any regression below 100%. Defensive branches are *tested*
// rather than excluded — there is deliberately no `/* v8 ignore */` in
// src/, because an ignore comment hides the branch it covers instead of
// proving it behaves. The bare `npm test` stays coverage-free for fast
// local iteration.
export default defineConfig({
  test: {
    // Restore anything `vi.stubEnv` touched after each test. Without this a
    // stub leaks into every later test in the file, and a test that reads an
    // env var would otherwise pass or fail on the developer's shell rather
    // than on the code.
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'], // stdio entry point — not unit-testable
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
