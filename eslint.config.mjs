// ESLint flat config (ESLint v9). Filename uses `.mjs` so Node loads it as
// ESM without forcing `"type": "module"` into package.json (which would
// affect every other .js tool in the repo).
//
// Purpose: Wave 7 i18n guard rail. After ~3500 keys were extracted into the
// i18n dictionaries (W0-W6), this config introduces `i18next/no-literal-string`
// at WARNING severity so any newly hardcoded UI string surfaces in lint output
// without breaking CI.
//
// Mode is the plugin default `jsx-text-only` — it only flags raw text inside
// JSX (e.g. `<h1>儲存</h1>`), not arbitrary string literals. This keeps the
// signal-to-noise ratio high: JSX text is almost always user-visible and
// almost always belongs in a dictionary.
//
// To run:
//   npx eslint .
//   npx eslint --max-warnings 9999 .   (CI-friendly: warnings don't fail)
//
// Severity is intentionally `warn` (not `error`). Per the i18n rollout plan
// (docs/i18n-rollout-plan-2026-05-04.md §10 row 5) this is the W7 deliverable;
// promoting to `error` is a future call once the warning backlog is triaged.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // 1) Global ignore list. Mirrors the directories the i18n rollout plan
  //    explicitly excluded plus generated / vendored / non-source areas.
  //    The intent of this lint pass is to protect `src/` only; everything
  //    else (backend, prototypes, archives, tooling) is out of scope.
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'coverage/**',
      '_archive_candidates/**',
      'backend/**',
      'server/**',
      'public/**',
      'e2e/**',
      'patient/**',
      'drug_api/**',
      'reports/**',
      'data/**',
      'output/**',
      'docs/**',
      'scripts/**',
      'func/**',
      '.venv312/**',
      '.pre-commit-cache/**',
      '.claude/**',
      // Reference / scratch directories that include non-ASCII names —
      // not part of the deployed app.
      '0_chatICU reference/**',
      '1150429_2nd_2_patients_1141001_1150501/**',
      '1_藥物＿季/**',
      '2_藥物交互作用＋相容性/**',
      '逆轉腎ai/**',
      '重複用藥＋交互作用/**',
      'src/imports/**',         // Figma-generated, not authored UI
      'src/i18n/locales/**',    // dictionary files themselves
      'src/styles/**',
      // Project root has many helper YAMLs / pngs / one-off scripts; only
      // lint actual application source under src/.
      '**/*.config.js',
      '**/*.config.ts',
      'playwright.config.*',
      'vite.config.*',
    ],
  },

  // 2) Baseline JS recommended (kept minimal — we only care about i18n today).
  js.configs.recommended,

  // 3) TypeScript parser + recommended rules without type-checking. Avoids
  //    requiring a tsconfig project reference which slows lint and isn't
  //    needed for the no-literal-string rule.
  ...tseslint.configs.recommended,

  // 4) Main rule block — applies the i18next plugin to source files.
  {
    files: ['src/**/*.{ts,tsx}'],
    // `react-hooks` is registered (but not enabled) so that the existing
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments
    // sprinkled across src/ don't produce "rule not found" errors.
    plugins: { i18next, 'react-hooks': reactHooks },
    // The rule isn't on, so the disable directives are technically
    // unused — silence that noise; we only want i18n warnings.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // The W7 guard rail. Default mode = `jsx-text-only` — only flags
      // raw JSX text, which is what we actually want extracted into
      // dictionaries. Hardcoded strings used as object values, log
      // messages, etc. are NOT reported (lower noise; we'd need a
      // separate audit to address those).
      //
      // jsx-attributes.exclude keeps the default Tailwind-friendly list
      // (className, style, type, key, id, ...) and adds the data/aria
      // props that should NOT block on translation (developer-only or
      // role-conveying tokens). aria-label / placeholder / title are
      // intentionally NOT excluded — those are user-visible and should
      // be translated.
      'i18next/no-literal-string': [
        'warn',
        {
          mode: 'jsx-text-only',
          'jsx-attributes': {
            exclude: [
              'className',
              'styleName',
              'style',
              'type',
              'key',
              'id',
              'width',
              'height',
              'role',
              'name',
              'href',
              'src',
              'target',
              'rel',
              'autoComplete',
              'autoCapitalize',
              'autoCorrect',
              'spellCheck',
              'inputMode',
              'data-.*',
              'aria-controls',
              'aria-haspopup',
              'aria-orientation',
              'aria-labelledby',
              'aria-describedby',
            ],
          },
          'jsx-components': {
            exclude: ['Trans'],
          },
        },
      ],

      // Intentionally relax noisy non-i18n rules so that this lint pass
      // stays focused on the i18n goal. Warnings only — easy to dial up
      // later in a dedicated PR.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      'no-empty': 'off',
      'no-empty-pattern': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'no-irregular-whitespace': 'off',
      'no-fallthrough': 'off',
      'no-case-declarations': 'off',
      'no-constant-binary-expression': 'off',
      'no-constant-condition': 'off',
      'no-cond-assign': 'off',
      'no-async-promise-executor': 'off',
      'no-self-assign': 'off',
      'no-redeclare': 'off',
      'no-undef': 'off', // TS already covers this and is more accurate.
      'getter-return': 'off',
      'valid-typeof': 'off',
    },
  },

  // 5) Test files: skip the i18n rule entirely (assertions / fixtures
  //    inevitably contain literal strings).
  {
    files: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/__tests__/**',
      'src/**/__mocks__/**',
    ],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },

  // 6) API client layer: usually only string literals are HTTP paths /
  //    error message templates that won't surface in the UI directly.
  //    Disable the rule there to cut false positives.
  {
    files: ['src/lib/api/**/*.{ts,tsx}'],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },
];
