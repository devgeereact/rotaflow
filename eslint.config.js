// Flat config (ESLint 9). Replaces `.eslintrc.cjs`.
//
// The move off eslintrc was forced, not cosmetic: `vite-plugin-checker@0.14`
// declares a peer on `eslint >= 9.39.4`, so `npm ci` failed with ERESOLVE
// against the old `eslint@^8.57.1` pin. ESLint 9 removed eslintrc support,
// so the config had to come with it.
//
// Rule set is a like-for-like port of the old file. `npm run lint` runs with
// `--max-warnings 0`, so a rule that changes severity or gains coverage here
// turns the build red — every deviation below is deliberate and noted.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    // Replaces `ignorePatterns`. Flat config has no implicit `node_modules`
    // entry in a custom `ignores`, so it stays listed explicitly.
    ignores: [
      'dist',
      'dev-dist',
      // Vitest's HTML coverage report ships its own un-typed helper scripts
      // (prettify.js, sorter.js, block-navigation.js). Without this, running
      // `npm run test:coverage` makes the very next `npm run lint` fail with
      // three parser errors about files nobody wrote — and `--max-warnings 0`
      // turns that into a red build for a reason that has nothing to do with
      // the code.
      'coverage',
      'node_modules',
      'postcss.config.js',
      'supabase/functions', // Deno runtime (npm:/jsr: specifiers) — not tsc/ESLint compatible
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  jsxA11y.flatConfigs.recommended,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Registered directly rather than by spreading each plugin's preset: the
    // old eslintrc listed these under `plugins` and enabled exactly the rules
    // below, extending no react-hooks/react-refresh preset. Pulling in v7's
    // `recommended-latest` here would switch on rules the old config never
    // ran, and `--max-warnings 0` turns any new finding into a red build.
    plugins: { 'react-refresh': reactRefresh, 'react-hooks': reactHooks },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Node CLI scripts. These are newly in scope: eslintrc + `eslint .` matched
    // only a narrow default set, while flat config also picks up `.mjs`, so
    // `scripts/plan-drift-audit.mjs` went from unlinted to 11 warnings — enough
    // to fail `--max-warnings 0` on a file the old config never read.
    //
    // Linted rather than ignored, so real bugs in it are still caught. Only the
    // two rules that make no sense for a CLI are relaxed: `console.log` IS this
    // script's output, and a return-type annotation on a top-level helper in a
    // standalone script is noise the app-side rule exists to prevent elsewhere.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  {
    // Type-aware rules need a file to be in the tsconfig project. Config and
    // script files are not, so they get the untyped treatment rather than
    // "file not found in project" parser errors.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
