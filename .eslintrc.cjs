/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:jsx-a11y/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh', 'jsx-a11y'],
  ignorePatterns: [
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
    '.eslintrc.cjs',
    'postcss.config.js',
    'supabase/functions', // Deno runtime (npm:/jsr: specifiers) — not tsc/ESLint compatible
  ],
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
};
