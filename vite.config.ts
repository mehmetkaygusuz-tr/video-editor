import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cloudflare Pages 25 MiB Asset Sınırı & Modern WebAssembly Optimizasyon Eklentisi
 * 
 * 1. generateBundle:
 *    Vite/Rollup derleme anında oluşturulan dosya ağacını (bundle) tarar.
 *    Modern WebGPU ve JSEP mimarisinde asla gerekmeyen, ancak pakette eski fallback olarak
 *    bulunan 25.6 MB'lık `ort-wasm-simd-threaded.asyncify.wasm` dosyasını çıktı listesinden düşürür.
 *    Böylece dosya diske hiç yazılmaz, I/O yükü oluşmaz ve Cloudflare Pages 25 MiB sınırına takılmaz.
 * 
 * 2. closeBundle (Defense-in-Depth):
 *    Derleme tamamlandıktan sonra dist/assets dizinini tarar.
 *    Eğer herhangi bir sebeple diske yazılmış asyncify dosyası kalmışsa temizler ve telemetry logu basar.
 */
function cloudflarePagesAssetGuard(): Plugin {
  const MAX_CLOUDFLARE_PAGES_BYTES = 25 * 1024 * 1024; // 25 MiB = 26,214,400 bytes

  return {
    name: 'cloudflare-pages-asset-guard',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const fileName in bundle) {
        const item = bundle[fileName];
        // 1. Asyncify içeren eski WASM fallback dosyasını derleme çıktısından temizle
        if (fileName.includes('asyncify') && fileName.endsWith('.wasm')) {
          delete bundle[fileName];
          console.log(`\n🛡️  [Cloudflare Pages Guard] Pruned obsolete asyncify WASM bundle: ${fileName}`);
          continue;
        }

        // 2. 25 MiB aşımı güvenlik kontrolü (Asset boyutu denetimi)
        if (item.type === 'asset') {
          const size = typeof item.source === 'string' 
            ? Buffer.byteLength(item.source) 
            : item.source.length;
          
          if (size > MAX_CLOUDFLARE_PAGES_BYTES) {
            console.warn(`\n⚠️  [Cloudflare Pages Guard] Warning: ${fileName} (${(size / (1024 * 1024)).toFixed(2)} MiB) exceeds 25 MiB limit!`);
          }
        }
      }
    },
    closeBundle() {
      // 1. Diske yazılmış olası kalıntıları temizle (Defense-in-depth)
      const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
      if (fs.existsSync(distAssetsDir)) {
        const files = fs.readdirSync(distAssetsDir);
        for (const file of files) {
          if (file.includes('asyncify') && file.endsWith('.wasm')) {
            const filePath = path.join(distAssetsDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log(`🛡️  [Cloudflare Pages Guard] Cleaned up legacy disk asset: ${file}`);
            } catch (err) {
              console.warn(`[Cloudflare Pages Guard] Could not unlink ${file}:`, err);
            }
          }
        }
      }

      // 2. Cloudflare Pages Resmi SPA Fallback Desteği (200.html)
      // _redirects döngü uyarılarına gerek kalmadan yerel SPA rotalamasını sağlar
      const distIndex = path.resolve(process.cwd(), 'dist/index.html');
      const dist200 = path.resolve(process.cwd(), 'dist/200.html');
      if (fs.existsSync(distIndex)) {
        try {
          fs.copyFileSync(distIndex, dist200);
        } catch (_) {}
      }
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    cloudflarePagesAssetGuard()
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
      onwarn(warning, defaultHandler) {
        if (warning.code === 'PLUGIN_TIMINGS') return;
        defaultHandler(warning);
      },
      // @ts-ignore - Rolldown performance diagnostic check option
      checks: {
        bundlerTimings: false
      },
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
