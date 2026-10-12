import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte()
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs.hf.co https://cdn-lfs-us-1.hf.co https://*.amazonaws.com https://*.s3.amazonaws.com https://*.cloudfront.net https://cdn.jsdelivr.net https://storage.googleapis.com ws: wss:; media-src 'self' blob: data: mediastream:; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self';",
    },
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs.hf.co https://cdn-lfs-us-1.hf.co https://*.amazonaws.com https://*.s3.amazonaws.com https://*.cloudfront.net https://cdn.jsdelivr.net https://storage.googleapis.com ws: wss:; media-src 'self' blob: data: mediastream:; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self';",
    },
  },
  worker: {
    format: 'es'
  },
  base: process.env.BASE_URL || './',
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@lucide/svelte')) {
              return 'vendor-icons';
            }
            if (id.includes('bits-ui')) {
              return 'vendor-ui';
            }
          }
        }
      }
    }
  }
});
