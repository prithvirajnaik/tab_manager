import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      thresholds: { lines: 90 },
      reporter: ['text-summary', 'text'],
    },
  },
});
