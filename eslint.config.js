import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', '.wxt/', '.output/', 'coverage/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      // The core must stay browser-free so it can be unit tested.
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'Use src/adapters/browser.ts' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['wxt', 'wxt/*', '**/adapters/*', 'preact', 'preact/*'] },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Untrusted titles and URLs must never be inserted as HTML.
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'No raw HTML.' },
        { selector: "MemberExpression[property.name='innerHTML']", message: 'No raw HTML.' },
      ],
    },
  },
);
