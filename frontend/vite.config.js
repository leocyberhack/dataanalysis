import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 调高警告阈值到 1000 KB (默认 500 KB)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 将大模块拆分为独立的代码块 (Code Split)
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'echarts-vendor': ['echarts', 'echarts-for-react'],
          'xlsx-vendor': ['xlsx'],
          'ui-vendor': ['lucide-react', 'react-select', 'react-datepicker']
        }
      }
    }
  }
})
