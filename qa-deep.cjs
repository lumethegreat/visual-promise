const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('🔍 TESTES DE APROFUNDAMENTO...\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1000);

  const bugs = [];

  // === Deep dive on Call Stack and console ===
  console.log('--- Ver estrutura completa da UI ---');
  const allText = await page.locator('body').innerText();
  console.log('Body text:\n' + allText.substring(0, 1000));

  // Check the specific call stack section
  const callStackHeader = await page.locator('text="CALL STACK"').first();
  const hasCallStack = await callStackHeader.isVisible().catch(() => false);
  console.log(`\n✓ CALL STACK header visível: ${hasCallStack}`);

  // Check if there are frames
  const noFramesText = await page.locator('text="No frames"').first();
  const noFramesVisible = await noFramesText.isVisible().catch(() => false);
  console.log(`ℹ "No frames" visível: ${noFramesVisible}`);

  // === Run the default code ===
  console.log('\n--- Clicar Run com código default ---');
  const runBtn = await page.locator('button:has-text("Run")').first();
  await runBtn.click();
  await page.waitForTimeout(2000);

  // Check after running
  const afterRunText = await page.locator('body').innerText();
  console.log('Body text após Run:\n' + afterRunText.substring(0, 1500));

  // Check for "example" frames or any frames
  const hasExampleFrames = afterRunText.includes('example');
  const hasAnonymousFrames = afterRunText.includes('<anonymous>');
  console.log(`\nℹ Call stack com frames de "example": ${hasExampleFrames}`);
  console.log(`ℹ Call stack com frames anónimos: ${hasAnonymousFrames}`);

  if (noFramesVisible && !hasExampleFrames && !hasAnonymousFrames) {
    bugs.push({
      num: 'A1',
      title: 'Call Stack mostra "No frames" após Run',
      desc: 'Após clicar Run com código async que inclui "example()", a call stack deveria mostrar frames de execução.',
      steps: ['Abrir app', 'Clicar Run'],
      expected: 'Call stack com frames (ex: example, anonymous) e estados',
      real: 'Call stack mostra "No frames"',
      severity: 'HIGH',
      visual: 'Painel CALL STACK apresenta apenas texto "No frames" sem frames visíveis'
    });
  }

  // === Check console after running ===
  const consolePanel = await page.locator('[class*="console"], [class*="Console"]').first();
  const consolePanelVisible = await consolePanel.isVisible().catch(() => false);
  console.log(`\n✓ Painel Console visível: ${consolePanelVisible}`);

  // Look for console items/lines specifically
  const consoleItems = await page.locator('[class*="item"], [class*="line"], [class*="entry"], [class*="log"]').all();
  console.log(`ℹ Itens de log no console: ${consoleItems.length}`);
  for (const item of consoleItems) {
    const text = await item.textContent().catch(() => '');
    console.log(`  → "${text}"`);
  }

  // === Test async code with console.log ===
  console.log('\n--- Testar código async com console.log ---');
  const resetBtn = await page.locator('button:has-text("Reset")').first();
  if (await resetBtn.isVisible()) await resetBtn.click();
  await page.waitForTimeout(500);

  const cmContent = await page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await page.keyboard.type('async function test() { console.log("hello"); return 1; }; test();', { delay: 20 });
  await page.waitForTimeout(500);

  await runBtn.click();
  await page.waitForTimeout(2000);

  const asyncText = await page.locator('body').innerText();
  if (!asyncText.includes('hello')) {
    bugs.push({
      num: 'A2',
      title: 'Console não mostra output de código async personalizado',
      desc: 'Ao executar código async com console.log("hello"), o output não aparece no painel Console.',
      steps: ['Escrever código async com console.log', 'Clicar Run'],
      expected: 'Console mostra "hello" e "1"',
      real: 'Console vazio ou sem output',
      severity: 'MEDIUM',
      visual: 'Painel Console não mostra nenhum output após executar código com console.log'
    });
  } else {
    console.log('✓ Output "hello" visível no body após código async');
  }

  // === Test step controls after Run ===
  console.log('\n--- Verificar botões de step controls ---');
  // The body text shows ▶ ▶ ▶▶ ▶ Run ↺ Reset — so play/pause might be combined or different
  const allBtns = await page.locator('button').all();
  const btnDetails = await Promise.all(allBtns.map(async b => ({
    text: await b.textContent().catch(() => ''),
    visible: await b.isVisible().catch(() => false),
    disabled: await b.getAttribute('disabled').catch(() => null)
  })));
  console.log('Botões:');
  btnDetails.forEach(b => console.log(`  "${b.text.trim()}" | visible=${b.visible} | disabled=${b.disabled}`));

  // === Test pause/play ===
  const playBtn = await page.locator('button').filter({ hasText: '▶' }).first();
  if (await playBtn.isVisible().catch(() => false)) {
    await playBtn.click();
    await page.waitForTimeout(1000);
    console.log('✓ Play clicado');

    // After play, pause should appear
    const pauseBtn = await page.locator('button').filter({ hasText: '⏸' }).first();
    const pauseVisible = await pauseBtn.isVisible().catch(() => false);
    console.log(`${pauseVisible ? '✓' : 'ℹ'} Pause visível após play: ${pauseVisible}`);
  }

  // Reset and check state clears
  console.log('\n--- Testar Reset ---');
  await page.locator('button:has-text("Reset")').first().click();
  await page.waitForTimeout(500);
  const afterResetText = await page.locator('body').innerText();
  const isCleaned = !afterResetText.includes('hello') && !afterResetText.includes('1');
  console.log(`${isCleaned ? '✓' : 'ℹ'} Estado limpo após reset: ${isCleaned}`);

  // === Test sync code ===
  console.log('\n--- Testar código síncrono ---');
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  await page.keyboard.type('let x = 1; console.log(x);', { delay: 20 });
  await page.waitForTimeout(500);
  await runBtn.click();
  await page.waitForTimeout(2000);

  const syncText = await page.locator('body').innerText();
  if (syncText.includes('1')) {
    console.log('✓ Output "1" visível para código síncrono');
  } else {
    console.log('ℹ Output "1" NÃO encontrado no body');
    // Check console specifically
    const consoleSection = await page.locator('text="Console"').first();
    if (await consoleSection.isVisible()) {
      const consoleIdx = (await page.locator('body').innerText()).indexOf('Console');
      console.log(`ℹ Texto após Console: ${(await page.locator('body').innerText()).substring(consoleIdx, consoleIdx + 200)}`);
    }
  }

  // === RELATÓRIO FINAL ===
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
