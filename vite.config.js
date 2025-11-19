import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(), 
    svgr(),
    renderer({
      nodeIntegration: true,
    }),
  ],
  base: './',
  build: {
    outDir: 'build',
    assetsDir: 'static',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'public/index.html'),
        navbar: path.resolve(__dirname, 'public/navbar.html'),
        overlay: path.resolve(__dirname, 'public/overlay.html')
      },
      output: {
        // Ensure navbar.html and index.html are at the root of build/
        entryFileNames: `static/[name]-[hash].js`,
        chunkFileNames: `static/[name]-[hash].js`,
        assetFileNames: `static/[name]-[hash].[ext]`
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});