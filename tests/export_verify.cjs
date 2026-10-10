const puppeteer = require('puppeteer');

async function testExportPipeline() {
  console.log('--- Starting Step 7 Exporter & Mediabunny Pipeline Verification ---');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('Export') || txt.includes('kodlama') || txt.includes('Mediabunny') || txt.includes('WebCut')) {
        console.log('PAGE LOG:', txt);
      }
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });

    // 1. Verify Exporter class is accessible and works in browser
    console.log('1. Testing Exporter module in browser environment...');
    const exportResult = await page.evaluate(async () => {
      const { Exporter } = await import('/src/lib/engine/Exporter.ts');
      if (!Exporter) throw new Error('Exporter class not exported!');

      // Run a mini 1-second 9:16 export test
      const res = await Exporter.exportProject({
        preset: 'tiktok_9_16',
        fps: 30,
        format: 'mp4',
        quality: 'high',
        onProgress: (pct, msg) => {
          console.log(`[ExportProgress ${pct}%] ${msg}`);
        }
      });

      return {
        filename: res.filename,
        sizeBytes: res.blob.size,
        type: res.blob.type,
        hasUrl: Boolean(res.url)
      };
    });

    console.log('✓ Export test completed:', exportResult);

    if (!exportResult.filename.endsWith('.mp4')) {
      throw new Error(`Invalid filename: ${exportResult.filename}`);
    }
    if (exportResult.sizeBytes <= 0) {
      throw new Error('Exported blob size is 0 bytes!');
    }
    if (exportResult.type !== 'video/mp4') {
      throw new Error(`Unexpected MIME type: ${exportResult.type}`);
    }

    // 2. Test WebM export
    console.log('2. Testing WebM format export...');
    const webmResult = await page.evaluate(async () => {
      const { Exporter } = await import('/src/lib/engine/Exporter.ts');
      const res = await Exporter.exportProject({
        preset: 'square_1_1',
        fps: 30,
        format: 'webm',
        quality: 'medium',
        onProgress: (pct, msg) => {
          console.log(`[WebMProgress ${pct}%] ${msg}`);
        }
      });

      return {
        filename: res.filename,
        sizeBytes: res.blob.size,
        type: res.blob.type
      };
    });

    console.log('✓ WebM export test completed:', webmResult);
    if (!webmResult.filename.endsWith('.webm')) {
      throw new Error(`Invalid WebM filename: ${webmResult.filename}`);
    }

    console.log('\n>>> STEP 7 EXPORT & MEDIABUNNY PIPELINE TEST PASSED! <<<');
  } catch (err) {
    console.error('Export test failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

testExportPipeline();
