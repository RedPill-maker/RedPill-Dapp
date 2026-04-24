import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths to adapt to electron applications
  define: {
    // Provide process.env to the browser environment
    'process.env': {},
    // Provide global for the browser environment
    global: 'globalThis'
  },
  resolve: {
    alias: {
      // Provides a polyfill for the assert module for the SDK
      assert: 'assert'
    }
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy filecoin local test network rpc request
      '/filecoin-rpc': {
        target: 'http://127.0.0.1:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/filecoin-rpc/, '/rpc/v1'),
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('Filecoin RPC proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Proxying Filecoin RPC request:', req.method, req.url);
          });
        }
      }
    }
  },
  optimizeDeps: {
    include: [
      '@secured-finance/stablecoin-lib-ethers',
      '@secured-finance/stablecoin-lib-base'
    ],
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis'
      }
    }
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    }
  }
})