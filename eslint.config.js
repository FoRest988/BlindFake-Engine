import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

const CDN_PATTERN = /cdn\.jsdelivr\.net|gstatic\.com|unpkg\.com|cdnjs\.cloudflare\.com/;

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'assets/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      // Hard errors: dynamic code evaluation is never acceptable (F0 gate).
      'no-new-func': 'error',
      'no-implied-eval': 'error',

      // Warnings that become errors in later phases (see docs/decisions/0000-rework-plan.md).
      'no-unsanitized/property': 'warn',
      'no-unsanitized/method': 'warn',
      'no-restricted-globals': ['warn', 'alert', 'prompt', 'confirm'],
      'no-restricted-syntax': [
        'warn',
        {
          selector: `Literal[value=${CDN_PATTERN}]`,
          message: 'Do not load code or assets from a CDN; ship them with the app (see rework plan F3/F4).',
        },
        {
          selector: `TemplateElement[value.raw=${CDN_PATTERN}]`,
          message: 'Do not load code or assets from a CDN; ship them with the app (see rework plan F3/F4).',
        },
      ],

      // Existing-code accommodations; tightened as the codebase is cleaned up.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
    },
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'server/**/*.ts', '*.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
);
