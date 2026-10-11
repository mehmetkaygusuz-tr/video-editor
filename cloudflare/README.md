# ToolX Video Editor - Cloudflare Worker Edge Yönlendirme Kılavuzu

Bu belge, **WebCut / ToolX Video Editor** projesinin `toolx.com.tr/video-editor` alt dizini altında Cloudflare Worker Edge Router kullanılarak canlıya alınması için gereken resmi yönergeleri ve kritik mimari detayları içerir.

---

## 🚀 1. Kritik Canlıya Alma Gereksinimleri

Projede WebCodecs, WebGPU ve ONNX WebAssembly SIMD (`ort-wasm-simd-threaded`) teknolojileri kullanıldığı için tarayıcıların en katı güvenlik standartlarına uygun yapılandırılması zorunludur:

### 1.1. SharedArrayBuffer & Çoklu İş Parçacığı (Multi-threading)
Modern tarayıcılar (Chrome, Edge, Safari, Firefox), `SharedArrayBuffer` özelliğini yalnızca aşağıdaki HTTP yanıt başlıkları mevcut olduğunda etkinleştirir:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: cross-origin`

> [!IMPORTANT]
> `cloudflare/worker.js` bu başlıkları tüm yanıtlara otomatik olarak ekler. Bu başlıklar olmadan yerel yapay zeka modelleri (Whisper, Silero VAD, Kokoro TTS) çalışamaz.

### 1.2. Trailing Slash ve Göreli Varlık (Relative Asset) Yolları
- Projenin `vite.config.ts` dosyasında `base: './'` ayarlandığından, varlıklar göreli yol olarak çağrılır (`./assets/...`).
- Kullanıcı `https://toolx.com.tr/video-editor` (sonda eğik çizgi olmadan) girdiğinde, tarayıcı varlıkları kök dizinde (`toolx.com.tr/assets/...`) arar ve 404 hatası oluşur.
- Hazırlanan Worker, `/video-editor` isteklerini otomatik olarak `/video-editor/` adresine **301 Moved Permanently** ile yönlendirir.
- Ayrıca Türkçe karakterle yazılan `/video-editör` istekleri de şeffaf biçimde `/video-editor/` adresine normalize edilir.

### 1.3. WASM MIME Türü
- `.wasm` dosyaları mutlaka `Content-Type: application/wasm` başlığıyla sunulmalıdır. Worker bunu garanti altına alır.

---

## 📦 2. Dağıtım (Deployment) Seçenekleri

### Yöntem A: Cloudflare Workers Static Assets ile Doğrudan Dağıtım (Önerilen)

En hızlı ve modern yöntemdir. Harici bir sunucuya ihtiyaç duymadan dosyaları doğrudan Cloudflare Edge ağına yükler.

1. Projeyi derleyin:
   ```bash
   npm run build
   ```
2. Cloudflare hesabınıza giriş yapın:
   ```bash
   npx wrangler login
   ```
3. `cloudflare` dizinine geçerek dağıtımı başlatın:
   ```bash
   cd cloudflare
   npx wrangler deploy
   ```

---

### Yöntem B: Cloudflare Dashboard Üzerinden Mevcut Sunucuya Ters Proxy (Reverse Proxy)

Eğer frontend halihazırda Cloudflare Pages, R2 veya başka bir sunucuda (Vercel, VPS) barınıyorsa:

1. `cloudflare/worker.js` dosyasını Cloudflare Dashboard -> **Workers & Pages** -> **Create Application** kısmına yapıştırın.
2. Worker ayarlarında **Variables** sekmesinden `ORIGIN_URL` ortam değişkenini tanımlayın (Örn: `https://toolx-editor.pages.dev`).
3. **Settings -> Domains & Routes** kısmından aşağıdaki route'ları ekleyin:
   - `toolx.com.tr/video-editor*`
   - `toolx.com.tr/video-editör*`

---

## 🔍 3. Yapılan İyileştirmeler ve Düzeltilen Sorunlar

1. **Vite Build Uyarıları Sıfırlandı:**
   - `[INEFFECTIVE_DYNAMIC_IMPORT]` uyarısı çözüldü (statik modül bağlama).
   - Rolldown / Vite 500kB+ chunk uyarısı çözüldü (Lucide ikonları ve Bits UI ayrıştırıldı).
   - `svelte-check` 0 hata ve 0 uyarı ile tamamlanmaktadır.
2. **Kayıp Arayüz Özelliği Eklendi:**
   - Modernize edilen `OklabColorWheel` (Oklab Renk Çarkı) doğrudan Filtreler / Renk sekmesine entegre edildi.
   - AI Üretim Merkezi modalı (Whisper, Silero, Kokoro TTS, Lisanslar) doğrudan arayüze ve AI Direktöre bağlandı.

