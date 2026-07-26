import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

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
      'src/components.d.ts',
      // React 迁移工程有独立的 eslint 配置（frontend-react/eslint.config.mjs）
      'frontend-react/**',
    ],
  },

  // ── Base JS/TS rules ────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Frontend (Vue + TS) ─────────────────────────────────
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,vue}', '*.config.{ts,js}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
      // 以下规则与 Prettier 冲突，关闭避免 CI 警告溢出
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-self-closing': 'off',
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
    files: ['*.config.{js,mjs,ts}'],
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
