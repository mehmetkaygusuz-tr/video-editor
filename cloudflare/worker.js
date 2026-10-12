/**
 * Cloudflare Worker - Edge Router & Subpath Gateway
 * Production Route: toolx.com.tr/video-editor* & toolx.com.tr/video-editör*
 *
 * 2026 Cloudflare Workers Standards:
 * - Edge subpath routing with trailing slash normalization
 * - SharedArrayBuffer security headers (COOP, COEP, CORP) for ONNX WebAssembly & WebCodecs
 * - Correct MIME types (application/wasm)
 * - Edge asset caching for immutable hashed bundles
 * - SPA (Single Page Application) fallback for client-side routing
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originalPath = url.pathname;

    // 1. Türkçe karakter ve yönlendirme normalizasyonu ('video-editör' -> 'video-editor')
    const decodedPath = decodeURIComponent(originalPath);
    if (decodedPath.startsWith('/video-editör')) {
      const redirectedPath = decodedPath.replace(/^\/video-editör/, '/video-editor');
      url.pathname = redirectedPath;
      return Response.redirect(url.toString(), 301);
    }

    // 2. Trailing slash normalizasyonu: '/video-editor' -> '/video-editor/'
    // Relative './assets/...' dosyalarının doğru çözümlenmesi için zorunludur.
    if (url.pathname === '/video-editor') {
      url.pathname = '/video-editor/';
      return Response.redirect(url.toString(), 301);
    }

    // Sadece /video-editor ve alt yollarına hizmet ver
    if (!url.pathname.startsWith('/video-editor/')) {
      // Eğer bu worker'a farklı bir istek düştüyse ana sunucuya ilet
      return fetch(request);
    }

    // 3. /video-editor/ önekini sıyırarak iç varlık yolunu belirle
    const relativeAssetPath = url.pathname.replace(/^\/video-editor/, '') || '/';

    // 4. Statik Varlığı Getir (Workers Assets veya Reverse Proxy)
    let response;
    try {
      if (env.ASSETS) {
        // Cloudflare Workers Static Assets binding (dist klasöründen)
        const assetUrl = new URL(request.url);
        assetUrl.pathname = relativeAssetPath;
        const assetRequest = new Request(assetUrl.toString(), request);
        
        response = await env.ASSETS.fetch(assetRequest);

        // SPA Fallback: Eğer dosya bulunamadıysa (404) ve HTML isteniyorsa index.html'i sun
        if (response.status === 404 && request.headers.get('accept')?.includes('text/html')) {
          const indexUrl = new URL(request.url);
          indexUrl.pathname = '/index.html';
          response = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));
        }
      } else if (env.ORIGIN_URL) {
        // Harici CDN / R2 / Pages veya Origin Sunucusu arkasından proxy
        const originUrl = new URL(env.ORIGIN_URL);
        originUrl.pathname = relativeAssetPath;
        originUrl.search = url.search;

        const proxyReq = new Request(originUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'follow',
          cf: {
            cacheEverything: relativeAssetPath.startsWith('/assets/'),
            cacheTtl: relativeAssetPath.startsWith('/assets/') ? 31536000 : 0
          }
        });

        response = await fetch(proxyReq);

        if (response.status === 404 && request.headers.get('accept')?.includes('text/html')) {
          originUrl.pathname = '/index.html';
          response = await fetch(originUrl.toString());
        }
      } else {
        // Varsayılan: İstek doğrudan origin'e iletilir
        response = await fetch(request);
      }
    } catch (err) {
      return new Response(`ToolX Edge Gateway Hatası: ${err.message}`, { status: 502 });
    }

    // 5. Yanıt Başlıklarını 2026 WebGPU / WebCodecs / WebAssembly Standartlarına Göre Donat
    const newHeaders = new Headers(response.headers);

    // [KRİTİK]: ONNX WebAssembly SIMD Threading ve SharedArrayBuffer için COOP & COEP
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
    newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
    newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

    // Güvenlik Başlıkları
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('X-Frame-Options', 'SAMEORIGIN');

    // MIME Türü Doğrulaması (WASM için zorunlu)
    if (url.pathname.endsWith('.wasm')) {
      newHeaders.set('Content-Type', 'application/wasm');
    }

    // Önbellek Stratejisi
    if (relativeAssetPath.startsWith('/assets/')) {
      // Hashed bundle'lar (JS, CSS, WASM) sonsuz süre önbelleklenebilir
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // HTML ve manifest dosyaları her zaman anlık güncellenmelidir
      newHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
};

