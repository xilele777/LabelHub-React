import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

function toNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

  return {
    base: env.VITE_APP_BASE || '/',
    plugins: [
      react(),
      visualizer({
        filename: 'dist/stats.html',
        open: false,
        gzipSize: true,
        brotliSize: true,
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: env.VITE_DEV_HOST || '127.0.0.1',
      // 默认 3100：迁移期需与 Vue 版(3000)并行对照运行
      port: toNumber(env.VITE_DEV_PORT, 3100),
      strictPort: false,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      host: env.VITE_PREVIEW_HOST || '127.0.0.1',
      port: toNumber(env.VITE_PREVIEW_PORT, 4273),
      strictPort: false,
    },
    build: {
      target: 'es2020',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // 对象形式的 manualChunks 会强制打包所列模块，因此只列已实际引用的包。
          // react-dom/client 须显式列出：数组项按解析后的模块匹配，只写 'react-dom'
          // 匹配不到 client 子路径入口，react-dom 实现体会漏进 entry chunk
          manualChunks: {
            react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
            request: ['axios'],
            state: ['zustand'],
            realtime: ['socket.io-client'],
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
  };
});
