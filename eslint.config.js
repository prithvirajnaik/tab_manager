import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', '.wxt/', '.output/', 'coverage/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ['src/core/links.ts', 'src/core/commands.ts'],
    rules: {
      // Records keyed by browser ids are the natural shape for session links.
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      // The core must stay browser-free so it can be unit tested.
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'Use src/adapters/browser.ts' },
        { name: 'browser', message: 'Use src/adapters/browser.ts' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'globalThis', property: 'chrome', message: 'Use src/adapters/browser.ts' },
        { object: 'globalThis', property: 'browser', message: 'Use src/adapters/browser.ts' },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['wxt', 'wxt/*', '**/adapters/*', 'preact', 'preact/*'] },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Untrusted titles and URLs must never be inserted as HTML.
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'No raw HTML.' },
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML|srcdoc)$/]',
          message: 'No raw HTML.',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]',
          message: 'No raw HTML.',
        },
        {
          selector:
            "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
          message: 'No raw HTML.',
        },
      ],
    },
  },
);
