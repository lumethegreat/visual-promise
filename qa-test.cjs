const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.log('❌ ERRO ao iniciar browser:', e.message);
    process.exit(1);
  }

  const page = await browser.newPage();
  const bugs = [];
  let testNum = 1;

  // Helper to report bug
  function addBug(num, title, desc, steps, expected, real, severity, visual) {
    bugs.push({ num, title, desc, steps, expected, real, severity, visual });
  }

  console.log('🧪 INICIANDO TESTES...\n');

  // --- TEST 1: App loads ---
  console.log(`[${testNum++}] TEST: App carrega`);
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
    const title = await page.title();
    console.log(`  ✓ Página carregou (title: "${title}")`);
  } catch (e) {
    addBug(1, 'App não carrega', 'A página não abre ou dá erro de rede',
      ['Navegar para http://localhost:5173'], 'Página carrega com sucesso', `Erro: ${e.message}`, 'CRITICAL',
      'Página em branco ou erro de rede');
    await browser.close();
    console.log('\n========== RELATÓRIO DE BUGS ==========\n');
    bugs.forEach(b => {
      console.log(`### BUG-[${b.num}]: ${b.title}`);
      console.log(`- **Descrição**: ${b.desc}`);
      console.log(`- **Passos**: ${b.steps.join(' → ')}`);
      console.log(`- **Esperado**: ${b.expected}`);
      console.log(`- **Real**: ${b.real}`);
      console.log(`- **Severidade**: ${b.severity}`);
      console.log(`- **Visual**: ${b.visual}`);
      console.log('');
    });
    process.exit(1);
  }

  await page.waitForTimeout(1000);

  // Check header
  const header = await page.locator('header, [class*="header"], [class*="Header"], h1').first();
  const headerVisible = await header.isVisible().catch(() => false);
  console.log(`  ${headerVisible ? '✓' : '✗'} Header visível`);

  // Check CodeMirror editor
  const editor = await page.locator('.cm-editor').first();
  const editorVisible = await editor.isVisible().catch(() => false);
  console.log(`  ${editorVisible ? '✓' : '✗'} Editor CodeMirror visível`);
  if (!editorVisible) {
    addBug(1, 'Editor CodeMirror não visível', 'O editor de código não aparece na UI',
      ['Abrir a app'], 'Editor CodeMirror visível', 'Editor não encontrado', 'CRITICAL',
      'Sem editor de código na página');
  }

  // Check step controls and buttons
  const allButtons = await page.locator('button').all();
  const btnTexts = await Promise.all(allButtons.map(b => b.textContent().catch(() => '')));
  const cleanedBtns = btnTexts.map(t => t.trim()).filter(Boolean);
  console.log(`  ℹ Botões encontrados: ${JSON.stringify(cleanedBtns)}`);

  // Check tabs
  const tabs = await page.locator('[role="tab"], [class*="tab"], [class*="Tab"]').all();
  console.log(`  ℹ Tabs de inspector: ${tabs.length}`);

  // Check all main sections
  const mainSections = await page.locator('section, main, [class*="panel"], [class*="Panel"], [class*="section"]').all();
  console.log(`  ℹ Secções/Painéis encontrados: ${mainSections.length}`);

  // Get page HTML snippet for debugging
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log(`  ℹ Body text (first 300 chars): ${bodyText.substring(0, 300)}`);

  // --- TEST 2: Click Run ---
  console.log(`\n[${testNum++}] TEST: Clicar Run`);
  try {
    const runBtn = await page.locator('button:has-text("Run"), button:has-text("RUN")').first();
    const runBtnVisible = await runBtn.isVisible().catch(() => false);
    console.log(`  ${runBtnVisible ? '✓' : '✗'} Botão Run visível`);

    if (runBtnVisible) {
      await runBtn.click();
      await page.waitForTimeout(1500);
      console.log('  ✓ Run clicado e executado');
    }
  } catch (e) {
    console.log(`  ✗ ERRO ao clicar Run: ${e.message}`);
    addBug(2, 'Erro ao clicar Run', e.message, ['Clicar botão Run'], 'Run executa sem erro', e.message, 'HIGH', 'Botão Run não funciona');
  }

  // --- TEST 3: Call Stack ---
  console.log(`\n[${testNum++}] TEST: Call Stack`);
  try {
    // Look for call stack related elements
    const callStackEl = await page.locator('text=/call.?stack/i, text=/stack/i, [class*="stack"]').all();
    console.log(`  ℹ Elementos relacionados com stack: ${callStackEl.length}`);
    const stackText = await Promise.all(callStackEl.map(el => el.textContent().catch(() => '')));
    console.log(`  ℹ Stack text: ${JSON.stringify(stackText.slice(0, 3))}`);

    // Check if any frame-like element exists
    const frames = await page.locator('[class*="frame"], [class*="Frame"], [class*="function"], [class*="Function"]').all();
    console.log(`  ℹ Frames da call stack: ${frames.length}`);
  } catch (e) {
    console.log(`  ✗ ERRO: ${e.message}`);
  }

  // --- TEST 4: Microtask Queue ---
  console.log(`\n[${testNum++}] TEST: Microtask Queue`);
  try {
    const microtaskEl = await page.locator('text=/microtask/i, text=/queue/i, [class*="microtask"], [class*="queue"]').all();
    console.log(`  ℹ Elementos relacionados com microtask: ${microtaskEl.length}`);
    const mText = await Promise.all(microtaskEl.map(el => el.textContent().catch(() => '')));
    console.log(`  ℹ Microtask text: ${JSON.stringify(mText.slice(0, 3))}`);
  } catch (e) {
    console.log(`  ✗ ERRO: ${e.message}`);
  }

  // --- TEST 5: Console Output ---
  console.log(`\n[${testNum++}] TEST: Console Output`);
  try {
    const consoleEl = await page.locator('text=/console/i, [class*="console"], [class*="output"], [class*="Output"]').all();
    console.log(`  ℹ Elementos relacionados com console: ${consoleEl.length}`);
    const cText = await Promise.all(consoleEl.map(el => el.textContent().catch(() => '')));
    console.log(`  ℹ Console text: ${JSON.stringify(cText.slice(0, 3))}`);
  } catch (e) {
    console.log(`  ✗ ERRO: ${e.message}`);
  }

  // --- TEST 6: Step Controls ---
  console.log(`\n[${testNum++}] TEST: Step Controls`);
  const stepControls = {
    play: await page.locator('button:has-text("Play"), button:has-text("▶")').first().isVisible().catch(() => false),
    pause: await page.locator('button:has-text("Pause"), button:has-text("⏸")').first().isVisible().catch(() => false),
    step: await page.locator('button:has-text("Step"), button:has-text("→")').first().isVisible().catch(() => false),
    speed: (await page.locator('[class*="speed"], [class*="Speed"]').all()).length,
  };
  console.log(`  Play: ${stepControls.play ? '✓' : '✗'}`);
  console.log(`  Pause: ${stepControls.pause ? '✓' : '✗'}`);
  console.log(`  Step Forward: ${stepControls.step ? '✓' : '✗'}`);
  console.log(`  Speed buttons: ${stepControls.speed}`);

  if (!stepControls.play && !stepControls.pause && !stepControls.step) {
    addBug(6, 'Step Controls ausentes', 'Os botões play/pause/step não estão visíveis',
      ['Abrir a app'], 'Botões de controlo de step visíveis', 'Nenhum controlo de step encontrado', 'HIGH',
      'Sem botões de step/play/pause');
  }

  // --- TEST 7: Reset ---
  console.log(`\n[${testNum++}] TEST: Reset`);
  const resetBtn = await page.locator('button:has-text("Reset"), button:has-text("RESET")').first();
  const resetExists = await resetBtn.isVisible().catch(() => false);
  console.log(`  ${resetExists ? '✓' : '✗'} Botão Reset visível`);
  if (resetExists) {
    await resetBtn.click();
    await page.waitForTimeout(500);
    console.log('  ✓ Reset clicado');
  }

  // --- TEST 8: Código personalizado async ---
  console.log(`\n[${testNum++}] TEST: Código personalizado async`);
  try {
    const cmContent = await page.locator('.cm-content').first();
    if (await cmContent.isVisible().catch(() => false)) {
      await cmContent.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);

      const asyncCode = 'async function test() { console.log("hello"); return 1; }; test();';
      await page.keyboard.type(asyncCode, { delay: 20 });
      await page.waitForTimeout(500);
      console.log('  ✓ Código async digitado');

      const runBtn2 = await page.locator('button:has-text("Run"), button:has-text("RUN")').first();
      if (await runBtn2.isVisible().catch(() => false)) {
        await runBtn2.click();
        await page.waitForTimeout(1500);
        console.log('  ✓ Run executado');

        // Check console output
        const consoleItems = await page.locator('[class*="console"], [class*="Console"], [class*="output"], [class*="Output"], [class*="item"]').allTextContents();
        const allConsoleText = consoleItems.join(' ');
        if (allConsoleText.toLowerCase().includes('hello')) {
          console.log('  ✓ Output "hello" encontrado no console');
        } else {
          console.log(`  ℹ Console output actual: ${allConsoleText.substring(0, 200)}`);
        }
      }
    } else {
      console.log('  ✗ Editor .cm-content não encontrado');
    }
  } catch (e) {
    console.log(`  ✗ ERRO: ${e.message}`);
    addBug(8, 'Erro no teste de código personalizado', e.message, ['Escrever código async', 'Clicar Run'],
      'Código executa e mostra output', e.message, 'MEDIUM', 'Teste crashou');
  }

  // --- TEST 9: Código síncrono ---
  console.log(`\n[${testNum++}] TEST: Código síncrono`);
  try {
    const cmContent2 = await page.locator('.cm-content').first();
    await cmContent2.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type('let x = 1; console.log(x);', { delay: 20 });
    await page.waitForTimeout(500);

    const runBtn3 = await page.locator('button:has-text("Run"), button:has-text("RUN")').first();
    if (await runBtn3.isVisible().catch(() => false)) {
      await runBtn3.click();
      await page.waitForTimeout(1500);
      const consoleItems2 = await page.locator('[class*="console"], [class*="Console"], [class*="output"], [class*="Output"]').allTextContents();
      const allConsoleText2 = consoleItems2.join(' ');
      if (allConsoleText2.includes('1')) {
        console.log('  ✓ Output "1" visível para código síncrono');
      } else {
        console.log(`  ℹ Console output actual: ${allConsoleText2.substring(0, 200)}`);
      }
    }
  } catch (e) {
    console.log(`  ✗ ERRO: ${e.message}`);
  }

  // --- TEST 10: Múltiplos awaits ---
  console.log(`\n[${testNum++}] TEST: Código com múltiplos awaits`);
  try {
    const cmContent3 = await page.locator('.cm-content').first();
    await cmContent3.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const multiAwait = `async function main() {
  const a = await Promise.resolve(1);
  const b = await Promise.resolve(2);
  console.log(a + b);
}
main();`;
    await page.keyboard.type(multiAwait, { delay: 20 });
    await page.waitForTimeout(500);

    const runBtn4 = await page.locator('button:has-text("Run"), button:has-text("RUN")').first();
    if (await runBtn4.isVisible().catch(() => false)) {
      await runBtn4.click();
      await page.waitForTimeout(2000);

      // Check all visible text for the result
      const fullText = await page.locator('body').innerText().catch(() => '');
      if (fullText.includes('3')) {
        console.log('  ✓ Output "3" visível para múltiplos awaits');
      } else {
        console.log(`  ℹ Não foi possível confirmar output "3". Body text snippet: ${fullText.substring(0, 300)}`);
      }
    }
  } catch (e) {
    console.log(`  ✗ ERRO: ${e.message}`);
  }

  // === RELATÓRIO ===
  console.log('\n\n========== RELATÓRIO DE BUGS ==========\n');

  if (bugs.length === 0) {
    console.log('✅ TODOS OS TESTES PASSARAM');
  } else {
    bugs.forEach(b => {
      console.log(`### BUG-[${b.num}]: ${b.title}`);
      console.log(`- **Descrição**: ${b.desc}`);
      console.log(`- **Passos**: ${b.steps.join(' → ')}`);
      console.log(`- **Esperado**: ${b.expected}`);
      console.log(`- **Real**: ${b.real}`);
      console.log(`- **Severidade**: ${b.severity}`);
      console.log(`- **Visual**: ${b.visual}`);
      console.log('');
    });
  }

  await browser.close();
  console.log('\n✅ Testes concluídos');
})();
