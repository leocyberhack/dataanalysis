import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 调高警告阈值到 1500 KB (echarts 自身较大)
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Keep React internals together so lazy-only vendors do not get pulled into the entry chunk.
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          const normalizedId = id.replace(/\\/g, '/');
          if (
            normalizedId.includes('/react/')
            || normalizedId.includes('/react-dom/')
            || normalizedId.includes('/react-router-dom/')
            || normalizedId.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (normalizedId.includes('/echarts') || normalizedId.includes('/zrender')) {
            return 'echarts-vendor';
          }
          if (normalizedId.includes('/xlsx/')) {
            return 'xlsx-vendor';
          }
          if (normalizedId.includes('/lucide-react/')) {
            return 'icons-vendor';
          }
          if (normalizedId.includes('/react-datepicker/') || normalizedId.includes('/date-fns/')) {
            return 'datepicker-vendor';
          }
          return undefined;
        }
      }
    }
  }
})
