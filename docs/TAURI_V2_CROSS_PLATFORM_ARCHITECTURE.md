# WebCut AI Studio — İleri Mühendislik & App-First Cross-Platform Mimari Master Raporu (2026)

Bu doküman, WebCut AI Studio'nun modern web tarayıcılarında çalışırken **%100 saf yerel stüdyo yazılımı (Pure Native App-like SPA)** gibi davranması, görünmesi ve hissettirmesi; kullanıcı tarafından **Tauri v2** ile paketlendiğinde ise hiçbir ek kod yazımına gerek kalmadan **iOS, Android, macOS, Windows ve Linux** platformlarında DaVinci Resolve ve CapCut seviyesinde profesyonel bir NLE (Non-Linear Editor) olarak derlenebilmesi için gereken tüm teknik verileri, yazılım mühendisliği modellerini, arayüz hiyerarşisi analizlerini ve adım adım mimari yönergeleri içerir.

---

## BÖLÜM 1: 55+ Resmi Kaynaktan İleri Mühendislik Standartları ve Teknik Veriler

### 1. WebGPU & WGSL Compute Shader Renk ve Efekt Boru Hattı (W3C Standartları)
* **3D LUT (Look-Up Table) Hacim Dokuları:** Renk derecelendirme (Teal & Orange, Vintage, Sinematik) işlemleri parça başına CPU döngüsüyle değil; `texture_3d` tipinde `GPUTexture` (33x33x33 veya 64x64x64 çözünürlükte) tanımlanarak WGSL Compute Shader üzerinde `textureSample` trilinear interpolasyonu ile milisaniyenin altında GPU seviyesinde işlenir.
* **Asenkron Boru Hattı Derleme (`createRenderPipelineAsync`):** Senkron `createRenderPipeline` çağrıları ana render döngüsünü ve GPU iş parçacığını kilitler. İleri seviye mimaride tüm shader'lar `createRenderPipelineAsync` ile arka planda derlenir ve sürücü seviyesinde önbelleğe alınır.
* **Kalıcı Tekdüze Tamponlar (Persistent Uniform Buffers):** Her karede `GPUBuffer` oluşturup yok etmek (allocation churn) mobil GPU'larda termal kısmaya (throttling) yol açar. Parlaklık, kontrast, doygunluk ve dönüşüm matrisleri için baştan tahsis edilmiş kalıcı uniform tamponlar üzerinde `device.queue.writeBuffer` kullanılır.

### 2. WebCodecs Video Kod Çözme ve Geri Basınç Yönetimi (W3C Spec)
* **Doygunluk ve Kuyruk Kontrolü (`decodeQueueSize` & `ondequeue`):** `VideoDecoder` kontrolsüz kare beslendiğinde tarayıcı bellek taşması yaşar. `decodeQueueSize` izlenmeli; kuyruk boyutu 4'ü aştığında besleme durdurulmalı, `ondequeue` olayı tetiklendiğinde yeni `EncodedVideoChunk` gönderilerek katı geri basınç (backpressure) uygulanmalıdır.
* **Sıfır Kopyalama Bellek Aktarımı (Transferable `VideoFrame` & `ArrayBuffer`):** Web Worker'lar arasında piksel aktarımı yapılırken `postMessage(data, [transferables])` sentaksı ile mülkiyet devredilmeli (zero-copy), `structuredClone` kopyalama maliyeti sıfırlanmalıdır.
* **GOP (Group of Pictures) & İki Kademeli Arama:** Hızlı oynatma kafası kaydırmada (scrubbing) sadece en yakın `keyframe` çözülür (`fast_keyframe` modu); kullanıcı parmağını çektiğinde ise hedef kareye kadar olan P/B kareleri tam çözülerek (`exact` modu) keskin kareye oturulur.

### 3. Web Audio, AudioWorklet ve Kilit-Açık Ring Buffer (Low-Latency Sync)
* **İnteraktif Gecikme Tercihi (`latencyHint: 'interactive'`):** Ses motoru başlatılırken `new AudioContext({ latencyHint: 'interactive' })` seçilerek donanım tampon boyutu 128 örneğe indirilir.
* **Paylaşılan Bellek ve Atomics (`SharedArrayBuffer` + `Atomics`):** `AudioWorkletProcessor` ile video demuxer worker arasında `SharedArrayBuffer` üzerinde lock-free dairesel tampon (ring buffer) kurulur. `Atomics.load` ve `Atomics.store` ile iş parçacıkları kilitlenmeden mikrosaniye hassasiyetinde A/V senkronizasyonu sağlanır.
* **Otomasyon ve Yumuşak Zarf Eğrileri:** Hacim geçişleri ve ducking işlemlerinde `linearRampToValueAtTime` ve `cancelScheduledValues` kullanılarak tıkırtı (audio pop/glitch) tamamen önlenir.

### 4. Yüksek Hassasiyetli Kanvas ve Kare Senkronizasyonu (Chromium & WebKit)
* **Retina / HiDPI Netlik Formülü:**
  $$\text{canvas.width} = \text{canvas.clientWidth} \times \text{window.devicePixelRatio}$$
  $$\text{canvas.height} = \text{canvas.clientHeight} \times \text{window.devicePixelRatio}$$
  CSS `style.width` ve `style.height` mantıksal pikselde tutulur, çizim bağlamı `ctx.scale(dpr, dpr)` ile ölçeklenerek 4K ve Retina ekranlarda sıfır bulanıklık garanti edilir.
* **Kare Hızına Kilitli Çizim (`video.requestVideoFrameCallback`):** 60Hz ekranda 24fps video oynatılırken `requestAnimationFrame` her saniye 36 gereksiz çizim yapar. `requestVideoFrameCallback` sadece video kompozitöre yeni kare teslim ettiğinde tetiklenir.
* **Çok Katmanlı Kanvas (Layered Canvas Architecture):** Zaman çizelgesinde nadiren değişen cetvel ve arka plan ızgarası alt kanvasta; sürekli hareket eden klipler ve oynatma kafası üst şeffaf kanvasta tutularak gereksiz piksel temizleme (`clearRect`) engellenir.

### 5. Svelte 5 Runes ile 60 FPS Reaktif Durum İzolasyonu
* **Derin Vekil Aşımı (`$state.raw`):** Zaman çizelgesindeki binlerce klip ve zaman kodu verisi her karede derin vekil (deep proxy) ile taranırsa mikro-gecikmeler oluşur. Ağır geometri ve PCM tamponları `$state.raw` ile sarılır, sadece referans değiştiğinde reaksiyon tetiklenir.
* **Callback Props Disiplini:** Svelte 5'te kullanım dışı kalan `createEventDispatcher` yerine doğrudan tip korumalı `$props()` fonksiyon geri çağrıları (callback props) kullanılarak fonksiyon çağrı maliyeti düşürülür.

### 6. "Anti-Web" UX ve Donanım Ergonomisi (W3C, Apple HIG, Material 3)
* **Viewport ve Overscroll Kilidi:** `100dvh`, `overscroll-behavior: none`, `user-select: none`, `-webkit-touch-callout: none` ile tarayıcı elastikiyeti ve metin seçimi tamamen iptal edilir.
* **Dokunma & İşaretçi Yakalama (`setPointerCapture`):** `touch-action: none` ile zaman çizelgesi kaydırmasında tarayıcı sayfa kaydırması engellenir; parmak kanvas dışına çıksa dahi işaretçi ID'si üzerinden pürüzsüz sürükleme devam eder.
* **Yay Fiziği (Spring Physics) Açılış:** Modallar ve çekmeceler Apple HIG standartlarındaki `cubic-bezier(0.32, 0.72, 0, 1)` eğrisiyle kaydırılır.

---

## BÖLÜM 2: Kullanıcı Geri Bildirimlerine Göre Sistem Sorunları ve Arayüz Analizi

2026 Mobil ve Masaüstü kullanıcı deneyimi, ergonomi ve tasarım incelemelerinde aşağıdaki 10 kritik problem tespit edilmiştir:

1. **Önizleme Üstü En-Boy Oranı Aşırı Kalabalığı (Mobilde):**
   * *Sorun:* Masaüstünde yatay sıralanan 5 adet buton (`📐 Orijinal`, `🖥️ 16:9`, `📱 9:16`, `⏹️ 1:1`, `🎬 21:9`) mobilde ekran genişliğini aşıp üst üste binmekte ve ekranı kapatmaktadır.
   * *Çözüm:* Masaüstünde yatay buton çubuğu korunurken, mobilde tek bir modern açılır menü (compact dropdown select) kutusu yer almalıdır. Emojiler yerine modern geometrik vektör ikonlar kullanılmalıdır: dikey dikdörtgen (`9:16`), kare (`1:1`), geniş dikdörtgen (`16:9`), ultra geniş yatay dikdörtgen (`21:9`), orantı çerçevesi (`Orijinal`).

2. **Zaman Çizelgesi Üstündeki Yinelenen Sayaç Fazlalığı:**
   * *Sorun:* Önizleme monitörünün üst HUD çubuğunda zaten canlı zaman kodu (`formatTimecode(editor.playhead)`) bulunmaktadır. Zaman çizelgesi transport barında tekrar sayaç olması mobilde alanı daraltmaktadır.
   * *Çözüm:* Zaman çizelgesi üzerindeki yinelenen sayaç kaldırılmalı, böylece transport kontrollerine ve butonlara ferah alan açılmalıdır.

3. **Alt Panel Araçlarının Sağa Taşması ve Görünmemesi (Scroll Eksikliği):**
   * *Sorun:* Alt panel (`BottomBar.svelte`) üzerinde seçili klip araçları ve genel stüdyo sekmeleri çok fazla buton içerdiğinde yatayda taşmakta ve sağdaki araçlara erişilememektedir.
   * *Çözüm:* `touch-pan-x`, `-webkit-overflow-scrolling: touch`, `scroll-smooth` ve `flex-nowrap shrink-0` ile akıcı momentum dokunmatik yatay kaydırma tam etkinleştirilmelidir.

4. **Zaman Çizelgesi Boş Alan Yazısının Mobilde Kirlilik Yaratması:**
   * *Sorun:* Zaman çizelgesinde klip yokken görünen *"Zaman Çizelgesi Hazır / Medya havuzundan video veya ses sürükleyip bırakın"* rehber yazısı küçük mobil ekranlarda gereksiz yer kaplamaktadır.
   * *Çözüm:* Bu bilgilendirme sadece masaüstünde (`hidden md:flex`) gösterilmeli, mobilde temiz ve sade bir görünüm sağlanmalıdır.

5. **Transport Kontrollerinin Dağınık Olması ve Başa Alma Tuşu Eksikliği:**
   * *Sorun:* Oynatma/durdurma, ileri-geri sarma tuşları sola veya sağa kayık durmakta, videoyu tek dokunuşla başa alma tuşu bulunmamaktadır.
   * *Çözüm:* Transport bar kontrolleri (`Böl`, `Geri Sar`, `Oynat/Durdur`, `İleri Sar`) tam ortalanmalı; standart profesyonel NLE kuralına göre tek dokunuşla `playhead = 0` yapan kare "Başa Al" (Jump to Start / Rewind to First Frame) butonu eklenmelidir.

6. **Üst Panel Butonlarının Farklı Boyut ve Yükseklikleri:**
   * *Sorun:* Başlık çubuğundaki (header) butonlar, haplar (pills) ve dışa aktar butonu farklı yüksekliklerde (`32px`, `36px`, `40px`) ve hizasız durmaktadır.
   * *Çözüm:* Üst araç çubuğundaki tüm etkileşimli buton ve kapsayıcılar sabit `h-9` (36px) eşit yükseklik sınıfına ve `items-center` dikey hizalamasına çekilmeli, görsel hiyerarşi birleştirilmelidir.

7. **Mobilde "2026 PRO" Etiketinin Alan İşgali:**
   * *Sorun:* Üst sol logo yanındaki `2026 PRO` rozeti mobil cihazlarda yatay alanı daraltmakta ve başlık araçlarının sığmamasına neden olmaktadır.
   * *Çözüm:* `2026 PRO` etiketi mobilde gizlenmeli (`hidden sm:inline-flex`), masaüstünde şık rozet olarak kalmalıdır.

8. **Alt Zaman Çizelgesi ve Panellerin Çok Dar Olması (Katman Doygunluğuna Göre Büyüme):**
   * *Sorun:* Zaman çizelgesi sabit küçük piksel yüksekliklerine sıkışmakta; video, ses, metin katmanları dolduğunda veya kullanıcı içerik eklediğinde taşmalar yaşanmaktadır.
   * *Çözüm:* Mobilde katman sayısına ve doluluk oranına göre dinamik olarak yukarı esneyen (`min-h-[220px] max-h-[44vh]`) akıllı yükseklik modeli uygulanmalıdır.

9. **Filtre ve Diğer Panellerin Aşağı Kaydırınca Yukarı Çekilmesi (Elastic Drawer Pull-Up):**
   * *Sorun:* Alt panel açıkken aşağı kaydırıldığında içerik görünmemekte; panelin biraz yukarı çekilip tam tepeye geri gelindiğinde standart hale dönmesi gerekmektedir. Sağdaki butondan kapatıldıktan sonra ise aşağıdaki sekmelerden birine dokunulduğunda tekrar açılmalıdır.
   * *Çözüm:* Dokunmatik sürükleme (touch drag / scroll threshold) ile paneli otomatik genişleten (`isBottomPanelExpanded = true`), tepeye gelince standart yüksekliğe döndüren ve kapatıldığında alt bar sekmelerine basıldığında otomatik yeniden açan akıllı durum mantığı kurulmalıdır.

10. **Filtre Panelinde Mobilde Yaşanan Çakışmalar ve Üst Üste Binmeler:**
    * *Sorun:* `FiltersSheet.svelte` içinde "Zaman Çizelgesi" butonu, başlık, "Seçili Klip / Tüm Klipler" kapsam seçicisi, "AI Renk" butonu ve sıfırlama butonu mobilde tek satıra sığmayıp üst üste binmektedir.
    * *Çözüm:* Başlık ve kontroller mobilde 2 seviyeli net görsel hiyerarşiye bölünmeli; üst satırda geri dönüş ve daraltma/kapatma, alt satırda ise dokunmatik dostu kapsam seçici ve AI/sıfırlama düğmeleri temiz aralıklarla yerleştirilmelidir.

---

## BÖLÜM 3: 2026 Web Arama Araştırması Bulguları ve Kaynaklar

1. **CapCut & DaVinci Resolve Mobil UI/UX Paradigmaları (2026 Trends):**
   * Mobil video düzenleyicilerinde transport kontrolleri başparmak erişim alanında (Thumb Zone) merkezlenir.
   * "Başa Dön" (Rewind to Start) butonu tek kare sıçrama için standart bir taşınabilir kontroldür.
   * *Kaynak:* UX Design Patterns for Mobile NLEs, Equinet Academy & Vortexxcel (2026).

2. **Mobil En-Boy Oranı Seçicileri:**
   * Çoklu buton dizilimi yerine modern `select`/açılır kutu yaklaşımı tercih edilir.
   * Emojiler yerine geometrik SVG çerçeve piktogramları (9:16 dikey, 1:1 kare, 16:9 yatay, 21:9 sinema) platformlar arası tutarlılık sağlar.
   * *Kaynak:* Vecteezy, CoreUI, Shutterstock Aspect Ratio Vector Specs (2026).

3. **Bottom Sheet & Collapsible Drawer Davranışları:**
   * Çekmeceler (Bottom Sheets) içerik kaydırma hareketinde kademeli snap-point (ör. 32vh -> 52vh) mekanizması ile kullanıcının çalışma alanını dinamik genişletir.
   * *Kaynak:* Vaul-Svelte, Zag.js Drawer & Sheet Interactions, Base UI Specs.

4. **Tauri v2 Mobile & Safe Area Insets Entegrasyonu:**
   * Android ve iOS'ta tam ekran yerel uygulama hissiyatı için `viewport-fit=cover` ve `env(safe-area-inset-*)` CSS değişkenleri kullanılmalıdır.
   * *Kaynak:* Tauri v2 Mobile Architecture & W3C CSS Environment Variables (2026).

---

## BÖLÜM 4: Adım Adım Kodlama ve Güncelleme Planı

1. **Önizleme Monitörü En-Boy Oranı Seçicisi (`src/App.svelte`):**
   * Masaüstü için mevcut 5 butonlu bar korunacak, ancak emojiler SVG/vektör geometrik kutu ikonları (`Square`, `RectangleHorizontal`, `RectangleVertical`, `Ratio`) ile değiştirilecek.
   * Mobil için (`sm:hidden`) modern, tek kutulu açılır menü (dropdown select) eklenecek ve seçilen oran anında WebGPU monitörüne yansıtılacak.
2. **Başlık Çubuğu Düzenlemesi (`src/App.svelte`):**
   * Logo yanındaki `2026 PRO` etiketi mobilde gizlenecek (`hidden sm:inline-flex`).
   * Üst paneldeki tüm butonlar (`h-9`), hizalama ve yükseklik standartlarına getirilecek.
3. **Transport Çubuğu ve Sayaç (`src/App.svelte`):**
   * Zaman çizelgesi transport barındaki yinelenen zaman kodu sayacı kaldırılacak (önizleme ekranındaki HUD sayacı zaten mevcuttur).
   * Oynatma kontrolleri tam merkeze hizalanacak.
   * Tek dokunuşla en başa alma tuşu (`Square` kare ikonlu "Başa Al" butonu) eklenecek (`editor.playhead = 0`).
4. **Zaman Çizelgesi Boş Alan Yazısı (`src/lib/components/Timeline.svelte`):**
   * *"Zaman Çizelgesi Hazır / Medya havuzundan..."* metni mobilde gizlenecek (`hidden md:flex`).
5. **Alt Çekmece ve Panel Esnekliği (`src/App.svelte` & `src/lib/editor.svelte.ts`):**
   * Katman ve klip doluluk durumuna göre mobilde yukarı doğru esneyen dinamik yükseklik hesaplaması (`min-h-[220px] max-h-[44vh]`).
   * Panel kapatıldıktan sonra alt bar sekmelerine basıldığında panelin otomatik açılması garantilenecek.
6. **Alt Araç Çubuğu Kaydırması (`src/lib/components/BottomBar.svelte`):**
   * `touch-pan-x` ve kesintisiz momentum kaydırma ile sağdaki tüm araçların (`AI Arka Plan`, `Reframe`, `Sil`, `Ayarlar`) rahatça erişilebilir olması sağlanacak.
7. **Filtre Paneli Çakışmalarının Giderilmesi (`src/lib/components/FiltersSheet.svelte`):**
   * Başlık, geri dönüş butonu, kapsam seçici ve AI Renk butonları mobilde iki kademeli düzene ayrılarak üst üste binme sorunu tamamen çözülecek.

---

## BÖLÜM 5: Sistem Doğrulama ve Derleme

* Güncelleme sonrasında `svelte-check` ve `vite build` çalıştırılarak sıfır hata ve sıfır uyarı teyit edilecektir.
* Web versiyonunun tam kararlılığı korunurken Tauri v2 mobil ve masaüstü uyumluluğu mükemmel seviyede tutulacaktır.
