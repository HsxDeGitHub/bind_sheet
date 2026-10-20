import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/exceljs')) return 'excel-export'
          if (id.includes('node_modules/@univerjs')) return 'spreadsheet'
        },
      },
    },
  },
  test: { environment: 'node' },
})
