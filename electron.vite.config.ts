import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },

  // NOTE: no externalizeDepsPlugin() here, and format is pinned to CJS on purpose.
  // Sandboxed preloads run as plain JavaScript with no ESM context and a polyfilled
  // require() that only resolves electron/events/timers/url. An ESM preload (which
  // electron-vite emits automatically if package.json ever gains "type": "module")
  // loads without error but its contextBridge globals never appear.
  preload: {
    build: {
      rollupOptions: {
        input: {
          shell: resolve(__dirname, 'src/preload/shell.ts'),
          account: resolve(__dirname, 'src/preload/account.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
