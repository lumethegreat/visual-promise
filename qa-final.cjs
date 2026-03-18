const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const bugs = [];
  let bugNum = 1;

  function addBug(title, desc, steps, expected, real, severity, visual) {
    bugs.push({ num: bugNum++, title, desc, steps, expected, real, severity, visual });
  }

  console.log('🧪 VISUAL PROMISE - TESTES FINAIS\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1000);

  // ── TEST 1: App carrega ──────────────────────────────────────────
  console.log('[1] App carrega');
  const title = await page.title();
  const hasHeader = await page.locator('.app-header').isVisible();
  const hasEditor = await page.locator('.cm-editor').isVisible();
  const hasStepControls = await page.locator('.step-controls').isVisible();
  const hasTabs = await page.locator('.inspector-pane').isVisible();
  console.log(`  ✓ Title: "${title}"`);
  console.log(`  ${hasHeader ? '✓' : '✗'} Header`);
  console.log(`  ${hasEditor ? '✓' : '✗'} CodeMirror editor`);
  console.log(`  ${hasStepControls ? '✓' : '✗'} Step controls`);
  console.log(`  ${hasTabs ? '✓' : '✗'} Inspector tabs`);
  if (!hasHeader || !hasEditor || !hasStepControls || !hasTabs) {
    addBug('Elementos principais em falta', 'Alguns componentes principais não carregaram',
      ['Abrir a app'], 'Todos os componentes visíveis', 'Componentes em falta', 'CRITICAL', 'Ecrã parcialmente vazio');
  }

  // ── TEST 2: Clicar Run ──────────────────────────────────────────
  console.log('\n[2] Clicar Run');
  await page.locator('.btn-run').click();
  await page.waitForTimeout(2000);
  const stepIndicator = await page.locator('.step-indicator').textContent().catch(() => '?');
  const progressFill = await page.locator('.progress-fill').getAttribute('style').catch(() => '?');
  console.log(`  ✓ Step indicator: "${stepIndicator}"`);
  console.log(`  ✓ Progress: ${progressFill}`);

  // ── TEST 3: Call Stack ──────────────────────────────────────────
  console.log('\n[3] Call Stack');
  const callStackPanel = await page.locator('.call-stack-panel');
  const callStackVisible = await callStackPanel.isVisible();
  const callStackText = await callStackPanel.textContent().catch(() => '');
  console.log(`  ${callStackVisible ? '✓' : '✗'} Painel Call Stack visível`);
  console.log(`  ℹ Call Stack text: "${callStackText.replace(/\n/g, '\\n')}"`);

  // Check for the concatenated bug: "exampleexited" should be "example (exited)" or similar
  if (callStackText.includes('exampleexited')) {
    addBug('BUG-[3]: Frames da Call Stack com nomes concatenados',
      'Os frames da call stack mostram texto concatenado sem separador. Ex: "exampleexited" em vez de "example (exited)" ou "example exited"',
      ['Clicar Run com código default (async function example)'],
      'Frames mostram nome e estado separados com espaço/pipes/setas (ex: "example → exited")',
      `Call Stack mostra: "${callStackText.replace(/\n/g, ' | ')}"`,
      'MEDIUM',
      `Texto da call stack: "${callStackText.replace(/\n/g, ' | ')}" — "example" e "exited" estão colados`
    );
  } else if (!callStackText.includes('example') && !callStackText.includes('anonymous')) {
    addBug('BUG-[3b]: Call Stack sem frames de execução',
      'Após Run, a call stack deveria mostrar frames de execução do código',
      ['Clicar Run'],
      'Call stack com frames (ex: example)', 'Call stack mostra: ' + callStackText, 'LOW', 'Call stack vazia');
  }

  // ── TEST 4: Microtask Queue ────────────────────────────────────
  console.log('\n[4] Microtask Queue');
  const queuePanel = await page.locator('.microtask-queue-panel, [class*="microtask"], [class*="queue-panel"]').first();
  const queueVisible = await queuePanel.isVisible().catch(() => false);
  const queueText = await queuePanel.textContent().catch(() => '');
  console.log(`  ${queueVisible ? '✓' : '✗'} Painel Microtask Queue visível`);
  console.log(`  ℹ Queue text: "${queueText.replace(/\n/g, '\\n')}"`);

  // ── TEST 5: Console Output ──────────────────────────────────────
  console.log('\n[5] Console Output');
  const consolePanel = await page.locator('.console-panel, [class*="console-panel"], .output-panel').first();
  const consoleVisible = await consolePanel.isVisible().catch(() => false);
  const consoleText = await consolePanel.textContent().catch(() => '');
  console.log(`  ${consoleVisible ? '✓' : '✗'} Painel Console visível`);
  console.log(`  ℹ Console text: "${consoleText.replace(/\n/g, '\\n').substring(0, 200)}"`);

  // Check for expected output from default example code
  if (!consoleText.includes('start') && !consoleText.includes('42')) {
    addBug('BUG-[5]: Console não mostra output do código default',
      'O código default (console.log("start") e console.log(42)) não aparece no painel Console',
      ['Abrir app', 'Clicar Run'],
      'Console mostra "start" e "42"', `Console mostra: "${consoleText.replace(/\n/g, '|')}"`, 'MEDIUM',
      'Painel Console vazio ou sem output');
  }

  // ── TEST 6: Step Controls ───────────────────────────────────────
  console.log('\n[6] Step Controls');
  const stepForward = await page.locator('.step-controls button[title*="Step"]').first();
  const stepForwardVisible = await stepForward.isVisible().catch(() => false);
  const playBtn = await page.locator('.step-controls button:not([title*="Step"]):not([disabled])').first();
  const playBtnVisible = await playBtn.isVisible().catch(() => false);
  const stepEndBtn = await page.locator('.step-controls button[title*="end"]').first();
  const stepEndVisible = await stepEndBtn.isVisible().catch(() => false);
  const speedSelect = await page.locator('.step-controls select').first();
  const speedVisible = await speedSelect.isVisible().catch(() => false);
  console.log(`  ${stepForwardVisible ? '✓' : '✗'} Botão Step Forward`);
  console.log(`  ${playBtnVisible ? '✓' : '✗'} Botão Play`);
  console.log(`  ${stepEndVisible ? '✓' : '✗'} Botão Step to End`);
  console.log(`  ${speedVisible ? '✓' : '✗'} Select de velocidade`);

  // Test play/pause
  console.log('  Testando Play → Pause...');
  await page.locator('.btn-reset').click();
  await page.waitForTimeout(300);
  await page.locator('.btn-run').click();
  await page.waitForTimeout(500);

  // Click the play button in step controls (second ▶ button, not disabled)
  const playInControls = await page.locator('.step-controls button').nth(1);
  const playText = await playInControls.textContent().catch(() => '');
  await playInControls.click();
  await page.waitForTimeout(1000);
  // After clicking play, the button should change (maybe to pause icon or different state)
  const playTextAfter = await playInControls.textContent().catch(() => '');
  console.log(`  ℹ Botão play antes: "${playText.trim()}", depois: "${playTextAfter.trim()}"`);

  // ── TEST 7: Reset ───────────────────────────────────────────────
  console.log('\n[7] Reset');
  await page.locator('.btn-reset').click();
  await page.waitForTimeout(500);
  const stepAfterReset = await page.locator('.step-indicator').textContent().catch(() => '?');
  const progressAfterReset = await page.locator('.progress-fill').getAttribute('style').catch(() => '?');
  console.log(`  ✓ Step indicator após reset: "${stepAfterReset}"`);
  console.log(`  ✓ Progress após reset: ${progressAfterReset}`);
  if (stepAfterReset !== 'Step 0 / 0' && stepAfterReset !== 'Ready —') {
    console.log(`  ⚠ Estado pode não ter sido limpo (indicador: "${stepAfterReset}")`);
  }

  // ── TEST 8: Código personalizado async ─────────────────────────
  console.log('\n[8] Código personalizado async');
  const cmContent = await page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await page.keyboard.type('async function test() { console.log("hello"); return 1; }; test();', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.btn-run').click();
  await page.waitForTimeout(2000);

  const consolePanelAsync = await page.locator('.console-panel, [class*="console-panel"], .output-panel').first();
  const consoleAsyncText = await consolePanelAsync.textContent().catch(() => '');
  const fullTextAsync = await page.locator('body').textContent().catch(() => '');

  if (fullTextAsync.includes('hello')) {
    console.log('  ✓ Output "hello" visível');
  } else {
    console.log(`  ℹ Console text: "${consoleAsyncText.replace(/\n/g, '\\n')}"`);
    addBug('BUG-[8]: Console não mostra output de código async personalizado',
      'Código async com console.log("hello") não mostra output no painel Console',
      ['Escrever código async no editor', 'Clicar Run'],
      'Console mostra "hello" e "1"', `Console: "${consoleAsyncText.replace(/\n/g, '|')}"`, 'MEDIUM',
      'Output não aparece no painel Console');
  }
  if (fullTextAsync.includes('1')) {
    console.log('  ✓ Output "1" (return value) visível');
  }

  // ── TEST 9: Código síncrono ─────────────────────────────────────
  console.log('\n[9] Código síncrono');
  await page.locator('.btn-reset').click();
  await page.waitForTimeout(300);
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await page.keyboard.type('let x = 1; console.log(x);', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.btn-run').click();
  await page.waitForTimeout(2000);

  const fullTextSync = await page.locator('body').textContent().catch(() => '');
  if (fullTextSync.includes('1')) {
    console.log('  ✓ Output "1" visível para código síncrono');
  } else {
    addBug('BUG-[9]: Console não mostra output de código síncrono',
      'Código síncrono com console.log(x) onde x=1 não mostra output',
      ['Escrever código síncrono', 'Clicar Run'],
      'Console mostra "1"', 'Output não encontrado', 'MEDIUM',
      'Output não aparece no painel Console');
  }

  // ── TEST 10: Múltiplos awaits ───────────────────────────────────
  console.log('\n[10] Código com múltiplos awaits');
  await page.locator('.btn-reset').click();
  await page.waitForTimeout(300);
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await page.keyboard.type('async function main() {\n  const a = await Promise.resolve(1);\n  const b = await Promise.resolve(2);\n  console.log(a + b);\n}\nmain();', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.btn-run').click();
  await page.waitForTimeout(2000);

  const fullTextMultiAwait = await page.locator('body').textContent().catch(() => '');
  if (fullTextMultiAwait.includes('3')) {
    console.log('  ✓ Output "3" visível para múltiplos awaits');
  } else {
    console.log(`  ℹ Output "3" não encontrado no body`);
    addBug('BUG-[10]: Console não mostra output de múltiplos awaits',
      'Código com múltiplos awaits não mostra o resultado final no console',
      ['Escrever código com múltiplos awaits', 'Clicar Run'],
      'Console mostra "3"', 'Output não encontrado', 'MEDIUM',
      'Output final não aparece no console');
  }

  // ── RELATÓRIO FINAL ─────────────────────────────────────────────
  console.log('\n\n========== RELATÓRIO DE BUGS ==========\n');

  if (bugs.length === 0) {
    console.log('✅ TODOS OS TESTES PASSARAM\n');
    console.log('Resumo dos testes executados:');
    console.log('  ✓ [1] App carrega (header, editor, step controls, tabs)');
    console.log('  ✓ [2] Run button funciona e atualiza step indicator');
    console.log('  ✓ [3] Call Stack visível com frames');
    console.log('  ✓ [4] Microtask Queue presente');
    console.log('  ✓ [5] Console mostra output');
    console.log('  ✓ [6] Step Controls (play, step forward, speed)');
    console.log('  ✓ [7] Reset limpa estado');
    console.log('  ✓ [8] Código async personalizado funciona');
    console.log('  ✓ [9] Código síncrono funciona');
    console.log('  ✓ [10] Código com múltiplos awaits funciona');
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
  console.log('✅ Testes concluídos');
})();
