import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests talk to the real Compose services, so allow for slower hooks and tests.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
