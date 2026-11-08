/**
 * Minimal ESLint flat config for the API (ESLint 8.57 flat-config mode).
 * Non-type-checked (no project service) so it runs fast and cannot fail on
 * circular type resolution; the real type safety gate remains `tsc --noEmit`.
 * Scoped to src/**; build output, runtime data and vendored dirs are ignored.
 */
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'dist/**',
      'data/**',
      'coverage/**',
      'node_modules/**',
      '**/*.js',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-fallthrough': 'error',
      'prefer-const': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-useless-escape': 'error',
      'no-control-regex': 'off',
    },
  },
  {
    // Vendored vendor-pattern tables (Madison extractor + extractor tables).
    // These files are almost entirely regex label/label-vendor pattern
    // constants where per-character over-escaping (`\-` in character classes,
    // `[\\s:]` in RegExp constructor templates) is intentional and harmless.
    // The rule stays at error for ALL other src files, so logic-code escapes
    // remain policed; widening this list must be a deliberate choice.
    files: [
      'src/services/madisonInvoiceExtractor.ts',
      'src/services/extractors/constants.ts',
      'src/services/extractors/dates.ts',
    ],
    rules: {
      'no-useless-escape': 'off',
    },
  },
];
