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
        // 将大模块拆分为独立的代码块 (Code Split)
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'echarts-vendor': [
            'echarts-for-react/lib/core',
            'echarts/charts',
            'echarts/components',
            'echarts/core',
            'echarts/renderers'
          ],
          'xlsx-vendor': ['xlsx'],
          'ui-vendor': ['lucide-react', 'react-select', 'react-datepicker']
        }
      }
    }
  }
})
