import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cloudflare Pages 25 MiB sınırını aşan ve modern tarayıcılarda WebGPU varken
 * hiçbir zaman kullanılmayan Emscripten fallback wasm dosyasını derleme sonrasında temizler.
 */
function cleanOversizedWasm(): Plugin {
  return {
    name: 'clean-oversized-wasm',
    closeBundle() {
      const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
      if (fs.existsSync(distAssetsDir)) {
        const files = fs.readdirSync(distAssetsDir);
        for (const file of files) {
          if (file.includes('asyncify') && file.endsWith('.wasm')) {
            const filePath = path.join(distAssetsDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log(`\n✓ [Cloudflare Optimization] Removed unused fallback WASM: ${file}`);
            } catch (err) {
              console.warn(`[Cloudflare Optimization] Could not remove ${file}:`, err);
            }
          }
        }
      }
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    cleanOversizedWasm()
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co ws: wss:; media-src 'self' blob: data: mediastream:; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self';",
    },
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co; media-src 'self' blob: data: mediastream:; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self';",
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
