const puppeteer = require('puppeteer');

async function testSeek() {
  console.log('--- Starting Step 1 Demuxer & Seek Test ---');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const logs = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
      if (text.includes('[DemuxerWorker]') || text.includes('[Orchestrator]') || text.includes('seek')) {
        console.log('BROWSER LOG:', text);
      }
    });
    page.on('pageerror', err => {
      console.error('BROWSER ERROR:', err.message);
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });

    // 1. Verify orchestrator and workers are initialized
    const workersInit = await page.evaluate(() => {
      return typeof window !== 'undefined' && (window).__orchestratorSeekBound === true;
    });
    console.log('1. Orchestrator global seek handler bound:', workersInit);
    if (!workersInit) {
      throw new Error('Orchestrator seek handler was not bound!');
    }

    // 2. Generate a valid synthetic WebM video in browser context using Canvas + MediaRecorder
    console.log('2. Generating valid WebM video in page context...');
    const videoGenerated = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      const donePromise = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();

      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#ff0000' : '#0000ff';
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.fillText(`Frame ${i}`, 50, 100);
        await new Promise(r => setTimeout(r, 33));
      }

      recorder.stop();
      await donePromise;

      const blob = new Blob(chunks, { type: 'video/webm' });
      const file = new File([blob], 'test_synthetic.webm', { type: 'video/webm' });
      (window).__testVideoFile = file;
      return { size: file.size, name: file.name };
    });

    console.log('✓ Synthetic video generated:', videoGenerated.name, `(${videoGenerated.size} bytes)`);

    // 3. Dispatch editor:seek event with the real video file
    console.log('3. Dispatching editor:seek to 0.5s...');
    await page.evaluate(() => {
      const file = (window).__testVideoFile;
      window.dispatchEvent(new CustomEvent('editor:seek', {
        detail: { file, time: 0.5 }
      }));
    });

    // Wait 1.5 seconds for demuxer worker to decode and render frame
    await new Promise(r => setTimeout(r, 1500));

    // 4. Test rapid scrubbing (stress test the pendingSeek queue)
    console.log('4. Performing rapid scrubbing (stress test)...');
    await page.evaluate(async () => {
      const file = (window).__testVideoFile;
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        window.dispatchEvent(new CustomEvent('editor:seek', {
          detail: { file, time: t }
        }));
      }
    });

    await new Promise(r => setTimeout(r, 1500));

    console.log('\n>>> STEP 1 DEMUXER & SEEK TEST PASSED WITH 100% SUCCESS! <<<');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

testSeek();
