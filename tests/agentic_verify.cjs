const puppeteer = require('puppeteer');

async function testAgenticEngine() {
  console.log('--- Starting Step 8 Agentic AI Orchestration & Multi-Track Verification ---');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const errors = [];
    page.on('pageerror', err => {
      console.error('PAGE ERROR:', err.message);
      errors.push(err.message);
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 15000 });
    console.log('✓ Main application loaded successfully.');

    // 1. Open and verify Omnibar component
    const cmdBtn = await page.$('button[title*="AI Komut Paleti"]');
    if (cmdBtn) {
      await cmdBtn.click();
      await new Promise(r => setTimeout(r, 200));
    }
    const omnibarInput = await page.$('input[placeholder*="Doğal dille kurgula"]');
    if (!omnibarInput) {
      throw new Error('Omnibar input not found on page!');
    }
    console.log('✓ Omnibar natural language input is present.');

    // 2. Test Single Natural Language Command via Omnibar
    await omnibarInput.click();
    await omnibarInput.type('yazı ekle: 2026 WebGPU AI Studio');
    const submitBtn = await page.$('button[title*="Komutu Çalıştır"]');
    if (!submitBtn) throw new Error('Omnibar submit button not found');
    await submitBtn.click();
    console.log('✓ Executed command: "yazı ekle: 2026 WebGPU AI Studio"');

    // Wait for execution
    await new Promise(r => setTimeout(r, 1200));

    // 3. Verify Agentic Telemetry in editor state
    const telemetry = await page.evaluate(() => {
      const ed = window.editor;
      const tracks = window.__videoEditorInstance?.tracks;
      return {
        hasInstance: !!window.__videoEditorInstance,
        tracksCount: tracks ? tracks.length : null
      };
    });

    // 4. Test In-Browser Agentic Intent Parsing directly in page context
    const intentVerification = await page.evaluate(async () => {
      // Find AgenticEditor via global or dynamic import
      try {
        const agent = window.agenticEditor || (await import('/src/lib/engine/AgenticEditor.ts')).agenticEditor;
        const ed = window.editor || window.__videoEditorInstance || (await import('/src/lib/editor.svelte.ts')).editor;

        const testCases = [
          { prompt: 'Sessizlikleri temizle ve boşlukları sil', expectedAction: 'JUMP_CUT_SILENCE' },
          { prompt: 'Whisper ile altyazı üret', expectedAction: 'GENERATE_AUTO_SUBTITLES' },
          { prompt: 'Müziğin ritmine göre kes', expectedAction: 'BEAT_SYNC_CUT' },
          { prompt: 'Yeşil perde olmadan arka planı sil', expectedAction: 'REMOVE_BACKGROUND' },
          { prompt: '9:16 reels için akıllı kadrajla', expectedAction: 'SMART_REFRAME' },
          { prompt: 'seslendir: Merhaba dünya', expectedAction: 'GENERATE_TTS' },
          { prompt: 'yazı ekle: Geleceğin Kurgusu', expectedAction: 'ADD_TEXT_OVERLAY' },
          { prompt: 'Klibi 1.5x hızlandır', expectedAction: 'CHANGE_SPEED' },
          { prompt: 'Oynatma kafasından klibi böl', expectedAction: 'SPLIT_AT_PLAYHEAD' },
          { prompt: 'Başını manyetik kırp', expectedAction: 'RIPPLE_TRIM_HEAD' },
          { prompt: 'Sonunu kırp ve birleştir', expectedAction: 'RIPPLE_TRIM_TAIL' },
          { prompt: 'Seçili klibi sil', expectedAction: 'DELETE_SELECTED' },
          { prompt: 'Son işlemi geri al', expectedAction: 'UNDO' }
        ];

        const parseResults = testCases.map(tc => {
          const parsed = agent.parseIntent(tc.prompt);
          return {
            prompt: tc.prompt,
            expected: tc.expectedAction,
            actual: parsed.action,
            confidence: parsed.confidence,
            passed: parsed.action === tc.expectedAction
          };
        });

        // Test Chained Command Execution
        const chainPrompt = 'yazı ekle: İlk Başlık ve 2x hızlandır';
        const chainRes = await agent.executeNaturalLanguageCommand(chainPrompt);

        // Read updated agentTelemetry
        const tel = {
          lastAction: ed.agentTelemetry.lastAction,
          lastIntentPrompt: ed.agentTelemetry.lastIntentPrompt,
          confidence: ed.agentTelemetry.confidence,
          status: ed.agentTelemetry.status,
          executionTimeMs: ed.agentTelemetry.executionTimeMs,
          activeModel: ed.agentTelemetry.activeModel
        };

        return {
          success: true,
          parseResults,
          chainResult: chainRes,
          telemetry: tel
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    if (!intentVerification.success) {
      throw new Error(`In-browser verification failed: ${intentVerification.error}`);
    }

    console.log(`✓ Intent Parser tested on ${intentVerification.parseResults.length} cases.`);
    const failedCases = intentVerification.parseResults.filter(r => !r.passed);
    if (failedCases.length > 0) {
      throw new Error(`Intent parser mismatch on: ${JSON.stringify(failedCases)}`);
    }
    console.log('✓ 100% of natural language intents correctly resolved to formal editing actions.');

    console.log('✓ Chained multi-step command result:', intentVerification.chainResult.message);
    if (!intentVerification.chainResult.success) {
      throw new Error(`Chained command failed: ${intentVerification.chainResult.message}`);
    }

    console.log('✓ Step 8 Agentic Telemetry:', JSON.stringify(intentVerification.telemetry));
    if (!intentVerification.telemetry.lastAction || intentVerification.telemetry.status !== 'completed') {
      throw new Error('Telemetry did not record completed status!');
    }

    if (errors.length > 0) {
      throw new Error(`Browser reported errors during test: ${errors.join(', ')}`);
    }

    console.log('\n>>> STEP 8 AGENTIC AI ORCHESTRATION & MULTI-TRACK ENGINE VERIFIED SUCCESSFULLY! <<<');
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

testAgenticEngine();
