import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx,js}'],
    // antd/@ant-design/icons 是数千个 ESM 小模块，逐模块 transform 会让组件冒烟
    // 测试的 import 阶段超过 2 分钟；esbuild 预打包后降到秒级（结果有磁盘缓存）
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['antd', '@ant-design/icons'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx'],
    },
  },
});
