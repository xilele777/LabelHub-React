import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'server/data/**',
      '**/*.db',
      '**/*.db-wal',
      '**/*.db-shm',
      'logs/**',
      'coverage/**',
      '*.md',
    ],
  },

  // ── Base JS/TS rules ────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Frontend (React + TS) ───────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },

  // ── Backend JS ──────────────────────────────────────────
  {
    files: ['server/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off', // Node.js globals
      'no-console': 'off', // Backend uses logger
    },
  },

  // ── Backend TS ──────────────────────────────────────────
  {
    files: ['server/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off', // Backend uses logger
    },
  },

  // ── Config files ────────────────────────────────────────
  {
    files: ['*.config.{js,mjs,cjs,ts}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-undef': 'off',
    },
  },

  // ── Standalone Node.js scripts ──────────────────────────
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-undef': 'off',
    },
  },
);
