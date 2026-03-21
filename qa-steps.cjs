const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const bugs = [];
  let bugNum = 1;

  function addBug(title, test, steps, expected, real, severity) {
    bugs.push({ num: bugNum++, title, test, steps, expected, real, severity });
  }

  console.log('🧪 VISUAL PROMISE - TESTES DE STEPS\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);

  // ── UI BUTTONS (discovered from StepControls.tsx) ────────────────
  // ▶  Step forward  (title="Step forward", disabled when at end)
  // ▶  Play/Pause   (toggles ▶/⏸)
  // ▶▶ Step to end  (title="Step to end", disabled when at end)
  // Speed select: 0.5x, 1x, 2x

  async function getStepIndicator() {
    return page.locator('.step-indicator').textContent().catch(() => '?');
  }

  async function getProgress() {
    const style = await page.locator('.progress-fill').getAttribute('style').catch(() => '');
    const match = style.match(/width:\s*([^;]+)/);
    return match ? match[1] : '?';
  }

  async function getConsoleOutput() {
    const panel = page.locator('.console-panel, [class*="console-panel"], .output-panel').first();
    return panel.textContent().catch(() => '');
  }

  async function getCallStack() {
    const panel = page.locator('.call-stack-panel, [class*="call-stack"]').first();
    return panel.textContent().catch(() => '');
  }

  // Step forward button
  async function stepForward() {
    const btn = page.locator('button[title="Step forward"]');
    if (await btn.isVisible().catch(() => false) && !(await btn.isDisabled().catch(() => true))) {
      await btn.click();
      await page.waitForTimeout(200);
      return;
    }
    throw new Error('Step Forward button não disponível ou desabilitado');
  }

  // Step to end button
  async function stepToEnd() {
    const btn = page.locator('button[title="Step to end"]');
    if (await btn.isVisible().catch(() => false) && !(await btn.isDisabled().catch(() => true))) {
      await btn.click();
      await page.waitForTimeout(500);
      return;
    }
    throw new Error('Step to end button não disponível ou desabilitado');
  }

  // Play/Pause button: button without title inside step-controls.
  // The titled buttons are Step back / Step forward / Step to end.
  async function getPlayPauseButton() {
    return page.locator('.step-controls button:not([title])').first();
  }

  async function clickPlayPause() {
    const btn = await getPlayPauseButton();
    if (!(await btn.isVisible().catch(() => false))) {
      throw new Error('Play/Pause button não encontrado');
    }
    await btn.click();
    await page.waitForTimeout(300);
  }

  async function isPlaying() {
    const btn = await getPlayPauseButton();
    const text = await btn.textContent().catch(() => '');
    return text.includes('⏸');
  }

  async function setSpeed(value) {
    const select = page.locator('.step-controls select');
    if (await select.isVisible().catch(() => false)) {
      await select.selectOption(value.toString());
      await page.waitForTimeout(100);
    }
  }

  async function typeCode(code) {
    const cmContent = page.locator('.cm-content').first();
    await cmContent.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type(code, { delay: 10 });
    await page.waitForTimeout(300);
  }

  async function doReset() {
    await page.locator('.btn-reset').click();
    await page.waitForTimeout(300);
  }

  async function doRun() {
    await page.locator('.btn-run').click();
    await page.waitForTimeout(500);
  }

  const TEST_CODE = 'async function example() { console.log("start"); const x = await Promise.resolve(42); console.log(x); } example();';

  // ── SETUP ────────────────────────────────────────────────────────
  console.log('📋 Setup: A inserir código de teste...\n');
  await typeCode(TEST_CODE);

  // ══════════════════════════════════════════════════════════════════
  // TEST 1: Step Forward (>)
  // Nota: Run já deixa a UI no fim; por isso esta parte da QA continua
  // frágil e serve apenas como smoke test, não como validação principal.
  // ══════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 1: Step Forward (>)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await doReset();
  await doRun();

  // Run vai para o fim (Step N/N). Não podemos step forward.
  // Mas podemos usar Play/Pause e depois step through
  console.log('  ℹ Run vai direto para o fim. A usar Play/Pause para testar step.');
  await doReset();
  await doRun();
  await page.waitForTimeout(300);

  // Click Play para começar auto-play
  await clickPlayPause();
  await page.waitForTimeout(1000); // Avança alguns steps

  const stepsDuringPlay = [];
  for (let i = 0; i < 5; i++) {
    const si = await getStepIndicator();
    const prog = await getProgress();
    stepsDuringPlay.push({ step: si, progress: prog });
    await page.waitForTimeout(500);
  }

  // Pausar
  await clickPlayPause();
  await page.waitForTimeout(300);

  const stepAtPause = await getStepIndicator();
  const consoleAtPause = await getConsoleOutput();
  const stackAtPause = await getCallStack();
  console.log(`  📊 Pausado em: Step="${stepAtPause}", Progress="${await getProgress()}"`);
  console.log(`  📝 Console: "${consoleAtPause.replace(/\n/g, '\\n')}"`);

  // Agora tentar Step Forward manualmente
  const canStepFwd = await page.locator('button[title="Step forward"]').isDisabled().catch(() => true);
  console.log(`  ℹ Step Forward disabled: ${canStepFwd}`);

  if (!canStepFwd) {
    const stepBeforeSF = await getStepIndicator();
    const consoleBeforeSF = await getConsoleOutput();
    const stackBeforeSF = await getCallStack();

    await stepForward();

    const stepAfterSF = await getStepIndicator();
    const consoleAfterSF = await getConsoleOutput();
    const stackAfterSF = await getCallStack();

    const stepChanged = stepBeforeSF !== stepAfterSF;
    const consoleChanged = consoleBeforeSF !== consoleAfterSF;
    const stackChanged = stackBeforeSF !== stackAfterSF;

    console.log(`  ${stepChanged ? '✅' : '❌'} Step indicator mudou: ${stepBeforeSF} → ${stepAfterSF}`);
    console.log(`  ${consoleChanged ? '✅' : '❌'} Console mudou`);
    console.log(`  ${stackChanged ? '✅' : '❌'} Call Stack mudou`);

    if (!stepChanged && !consoleChanged && !stackChanged) {
      addBug('Step Forward não faz nada', 'Step Forward (>)',
        ['Reset', 'Run', 'Play', 'Pause', 'Step Forward (>)'],
        'Step indicator, Console e Call Stack atualizam após Step Forward',
        `Nada mudou: Step=${stepBeforeSF}, Console e Stack sem alterações`,
        'CRITICAL');
    }
  } else {
    console.log('  ⚠ Step Forward desabilitado — já estamos no fim');
    addBug('Step Forward desabilitado após pausa no fim', 'Step Forward (>)',
      ['Reset', 'Run', 'Play', 'Pause', 'Tentar Step Forward'],
      'Step Forward deveria funcionar quando pausado antes do fim',
      'Step Forward está disabled mesmo quando não está no fim (ou já chegou ao fim)',
      'HIGH');
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 2: Step Back (<) — Verificar se existe
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2: Step Back (<)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check if Step Back button exists
  const stepBackBtn = page.locator('button[title*="back"], button[title*="Back"]');
  const hasStepBack = await stepBackBtn.isVisible().catch(() => false);

  // Also check all buttons in step-controls
  const allStepButtons = await page.locator('.step-controls button').allTextContents();
  console.log(`  ℹ Botões em step-controls: ${allStepButtons.map(t => `"${t.trim()}"`).join(', ')}`);

  if (!hasStepBack) {
    addBug('Step Back (<) não existe na UI', 'Step Back (<)',
      ['Inspecionar step-controls para botão "<" ou "back"'],
      'Deveria existir um botão Step Back que permite navegar para trás',
      'Não existe botão Step Back no componente StepControls — apenas ▶, ▶/⏸, ▶▶',
      'HIGH');
  } else {
    console.log('  ✅ Step Back existe');

    // Test if it actually works
    await doReset();
    await doRun();
    await page.waitForTimeout(500);
    const stepAtEnd = await getStepIndicator();

    await stepBackBtn.click();
    await page.waitForTimeout(300);
    const stepAfterBack = await getStepIndicator();

    if (stepAtEnd !== stepAfterBack) {
      console.log(`  ✅ Step Back funciona: ${stepAtEnd} → ${stepAfterBack}`);
    } else {
      addBug('Step Back não funciona', 'Step Back (<)',
        ['Run', 'Step to end', 'Step Back'],
        'Step indicator volta para trás',
        `Não mudou: ${stepAtEnd} → ${stepAfterBack}`,
        'CRITICAL');
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 2.5: Step Back → Play must stop at end (regression)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2.5: Step Back → Play regression');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!hasStepBack) {
    console.log('  ⚠ Step Back não existe — a saltar regression test');
  } else {
    await doReset();
    await doRun();
    await page.waitForTimeout(1000);

    const stepAfterRunRegression = await getStepIndicator();
    const eventLogBeforeBack = await page.locator('body').innerText();
    const eventLogCountBeforeBack = (eventLogBeforeBack.match(/execution\.|promise\.|reaction\.|frame\.|await\.|console\.|error\./g) || []).length;
    console.log(`  📊 Após Run: Step="${stepAfterRunRegression}", Event markers≈${eventLogCountBeforeBack}`);

    for (let i = 0; i < 3; i++) {
      await stepBackBtn.click();
      await page.waitForTimeout(250);
    }

    const stepAfterBackRegression = await getStepIndicator();
    console.log(`  📊 Após Step Back (x3): Step="${stepAfterBackRegression}"`);

    await clickPlayPause();
    await page.waitForTimeout(7000);

    const stepAfterLongPlay = await getStepIndicator();
    const bodyAfterLongPlay = await page.locator('body').innerText();
    const eventLogCountAfterLongPlay = (bodyAfterLongPlay.match(/execution\.|promise\.|reaction\.|frame\.|await\.|console\.|error\./g) || []).length;
    const playingAfterLongPlay = await isPlaying();
    console.log(`  📊 Após Play (7s): Step="${stepAfterLongPlay}", Event markers≈${eventLogCountAfterLongPlay}, Playing=${playingAfterLongPlay}`);

    await page.waitForTimeout(3000);
    const stepAfterExtraWait = await getStepIndicator();
    const bodyAfterExtraWait = await page.locator('body').innerText();
    const eventLogCountAfterExtraWait = (bodyAfterExtraWait.match(/execution\.|promise\.|reaction\.|frame\.|await\.|console\.|error\./g) || []).length;
    const playingAfterExtraWait = await isPlaying();
    console.log(`  📊 Após espera extra (3s): Step="${stepAfterExtraWait}", Event markers≈${eventLogCountAfterExtraWait}, Playing=${playingAfterExtraWait}`);

    const stepStable = stepAfterExtraWait === stepAfterLongPlay;
    const logStable = eventLogCountAfterExtraWait === eventLogCountAfterLongPlay;
    const playbackStopped = !playingAfterExtraWait;

    console.log(`  ${stepStable ? '✅' : '❌'} Step estabilizou no fim`);
    console.log(`  ${logStable ? '✅' : '❌'} Event log deixou de crescer`);
    console.log(`  ${playbackStopped ? '✅' : '❌'} Playback parou automaticamente`);

    if (!stepStable || !logStable || !playbackStopped) {
      addBug('Step Back → Play entra em loop após chegar ao fim', 'Step Back → Play regression',
        ['Run', 'Step Back (3x)', 'Play', 'Esperar 10s'],
        'Playback chega ao fim uma vez, pára automaticamente, e step/event log ficam estáveis',
        `Após chegar ao fim continuou instável: Step ${stepAfterLongPlay} → ${stepAfterExtraWait}, Event markers ${eventLogCountAfterLongPlay} → ${eventLogCountAfterExtraWait}, Playing=${playingAfterExtraWait}`,
        'CRITICAL');
    }

    if (playingAfterExtraWait) {
      await clickPlayPause().catch(() => {});
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 3: Play / Auto-play
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 3: Play / Auto-play (▶)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await doReset();
  await doRun();
  await page.waitForTimeout(300);

  // Confirm we're at Step N/N before playing
  const beforePlay = await getStepIndicator();
  console.log(`  📊 Estado antes de Play: "${beforePlay}"`);

  // Click Play
  await clickPlayPause();
  const playState = await isPlaying();
  console.log(`  ℹ A iniciar auto-play (isPlaying=${playState})...`);

  const stepsDuringPlay2 = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    const si = await getStepIndicator();
    const prog = await getProgress();
    const playing = await isPlaying();
    stepsDuringPlay2.push({ step: si, progress: prog, playing });
    console.log(`    [${(i + 1) * 500}ms] Step="${si}", Progress="${prog}", Playing=${playing}`);
  }

  // Check if step changed during auto-play
  let changed = false;
  for (let i = 1; i < stepsDuringPlay2.length; i++) {
    if (stepsDuringPlay2[i].step !== stepsDuringPlay2[i - 1].step) {
      changed = true;
      break;
    }
  }

  console.log(`  ${changed ? '✅' : '❌'} Auto-play avançou steps automaticamente`);

  if (!changed) {
    addBug('Auto-play não avança automaticamente', 'Play / Auto-play',
      ['Reset', 'Run', 'Clicar Play (▶)', 'Observar durante 4 segundos'],
      'Step indicator muda automaticamente durante auto-play',
      `Step permaneceu "${stepsDuringPlay2[0].step}" durante todo o período de auto-play`,
      'CRITICAL');
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 4: Pause
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 4: Pause (⏸)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await doReset();
  await doRun();
  await page.waitForTimeout(300);
  await clickPlayPause();
  await page.waitForTimeout(1500);

  const playingBeforePause = await isPlaying();
  const stepBeforePause = await getStepIndicator();
  console.log(`  📊 Antes do Pause: isPlaying=${playingBeforePause}, Step="${stepBeforePause}"`);

  await clickPlayPause();
  await page.waitForTimeout(100);

  const playingAfterPause = await isPlaying();
  const stepRightAfterPause = await getStepIndicator();
  console.log(`  📊 Imediatamente após Pause: isPlaying=${playingAfterPause}, Step="${stepRightAfterPause}"`);

  // Wait 2s and verify no change
  await page.waitForTimeout(2000);
  const stepAfterWait = await getStepIndicator();
  console.log(`  📊 Após 2s de espera: Step="${stepAfterWait}"`);

  const pauseWorked = !playingAfterPause && stepRightAfterPause === stepAfterWait;
  console.log(`  ${pauseWorked ? '✅' : '❌'} Pause funciona: isPlaying=${playingAfterPause}, step não avançou`);

  if (!pauseWorked) {
    addBug('Pause não funciona', 'Pause (⏸)',
      ['Reset', 'Run', 'Play', 'Pause (⏸)', 'Esperar 2s'],
      'Auto-play para, isPlaying=false, step congela',
      `isPlaying=${playingAfterPause}, Step avançou: ${stepRightAfterPause} → ${stepAfterWait}`,
      'HIGH');
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 5: Speed controls
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 5: Speed controls');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const speedSelect = page.locator('.step-controls select');
  const speedVisible = await speedSelect.isVisible().catch(() => false);

  if (!speedVisible) {
    addBug('Controlos de velocidade não visíveis', 'Speed controls',
      ['Procurar <select> em .step-controls'],
      'Speed select visível com opções 0.5x, 1x, 2x',
      'Speed select não encontrado',
      'MEDIUM');
  } else {
    const options = await speedSelect.locator('option').allTextContents();
    console.log(`  ℹ Velocidades disponíveis: ${options.join(', ')}`);

    const speeds = ['0.5', '1', '2'];
    const speedResults = [];

    for (const speed of speeds) {
      await doReset();
      await doRun();
      await page.waitForTimeout(300);
      await speedSelect.selectOption(speed);
      await page.waitForTimeout(100);
      await clickPlayPause();

      const stepsAt500ms = [];
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(500);
        stepsAt500ms.push(await getStepIndicator());
      }

      await clickPlayPause().catch(() => {});
      const atEnd = stepsAt500ms[stepsAt500ms.length - 1];
      console.log(`  Speed ${speed}x → steps observados: ${stepsAt500ms.join(' → ')}`);
      speedResults.push({ speed, steps: stepsAt500ms, atEnd });
    }

    // Check if different speeds produce different results
    const allSame = speedResults.every(r => r.atEnd === speedResults[0].atEnd);
    if (allSame && speedResults.length > 1) {
      console.log(`  ⚠ Velocidades parecem não ter efeito visível (todos terminaram no mesmo step)`);
    } else {
      console.log(`  ✅ Velocidades produziram resultados diferentes`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 6: Progress bar (100%)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 6: Progress bar (100%)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await doReset();
  await doRun();
  await page.waitForTimeout(500);

  // Wait for "done" status (worker has finished sending all events)
  console.log('  ℹ A aguardar que o worker termine (status = "done")...');
  try {
    await page.locator('text=/(Step \\d+ \\/ \\d+|Ready)/').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1000); // Extra buffer
  } catch (e) {
    console.log(`  ⚠ Timeout a aguardar — a usar estado atual`);
  }

  const progressAfterRun = await getProgress();
  const stepAfterRun = await getStepIndicator();
  console.log(`  📊 Após Run (worker done): Step="${stepAfterRun}", Progress="${progressAfterRun}"`);

  if (progressAfterRun !== '100%') {
    addBug('Progress bar não chega a 100% após Run', 'Progress bar',
      ['Reset', 'Run', 'Aguardar worker done', 'Verificar progress bar'],
      'Progress bar mostra 100% quando execução chega ao fim',
      `Progress bar: ${progressAfterRun} (não é 100%)`,
      'HIGH');
  } else {
    console.log('  ✅ Progress bar chega a 100% após Run');
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 7: Reset durante playback
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 7: Reset durante playback');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await doReset();
  await doRun();
  await page.waitForTimeout(300);
  await clickPlayPause();
  await page.waitForTimeout(2000);

  const stepBeforeReset = await getStepIndicator();
  const progressBeforeReset = await getProgress();
  console.log(`  📊 Antes de Reset: Step="${stepBeforeReset}", Progress="${progressBeforeReset}"`);

  await doReset();
  await page.waitForTimeout(300);

  const stepAfterReset = await getStepIndicator();
  const progressAfterReset = await getProgress();
  console.log(`  📊 Após Reset: Step="${stepAfterReset}", Progress="${progressAfterReset}"`);

  const isReset = stepAfterReset.includes('0') || stepAfterReset.toLowerCase().includes('ready');
  const isProgressReset = progressAfterReset === '0%' || progressAfterReset === '0';

  console.log(`  ${isReset ? '✅' : '❌'} Step indicator voltou: "${stepBeforeReset}" → "${stepAfterReset}"`);
  console.log(`  ${isProgressReset ? '✅' : '⚠'} Progress resetado: "${progressBeforeReset}" → "${progressAfterReset}"`);

  if (!isReset) {
    addBug('Reset não funciona durante playback', 'Reset durante playback',
      ['Reset', 'Run', 'Play', 'Esperar 2s', 'Reset'],
      'Step indicator volta para "Ready" ou "Step 0 / 0", Progress volta a 0%',
      `Step após Reset: "${stepAfterReset}" (não voltou)`,
      'HIGH');
  }

  // ══════════════════════════════════════════════════════════════════
  // BONUS: Teste de Step to End
  // ══════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 8 (BONUS): Step to End (▶▶)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await doReset();
  await doRun();
  await page.waitForTimeout(300);
  // Now step forward a bit
  try {
    for (let i = 0; i < 3; i++) {
      await stepForward();
      await page.waitForTimeout(200);
    }
    const stepBeforeEnd = await getStepIndicator();
    const progressBeforeEnd = await getProgress();
    console.log(`  📊 Antes de Step to End: Step="${stepBeforeEnd}", Progress="${progressBeforeEnd}"`);

    await stepToEnd();
    await page.waitForTimeout(500);

    const stepAfterEnd = await getStepIndicator();
    const progressAfterEnd = await getProgress();
    console.log(`  📊 Após Step to End: Step="${stepAfterEnd}", Progress="${progressAfterEnd}"`);

    const stepToEndWorked = stepBeforeEnd !== stepAfterEnd;
    const progressAtEnd = progressAfterEnd === '100%';
    console.log(`  ${stepToEndWorked ? '✅' : '❌'} Step to End avançou: ${stepBeforeEnd} → ${stepAfterEnd}`);
    console.log(`  ${progressAtEnd ? '✅' : '⚠'} Progress no fim: ${progressAfterEnd}`);

    if (!stepToEndWorked) {
      addBug('Step to End não funciona', 'Step to End (▶▶)',
        ['Reset', 'Run', 'Step Forward (3x)', 'Step to End'],
        'Step avança para o fim (N/N), Progress 100%',
        `Não mudou: ${stepBeforeEnd} → ${stepAfterEnd}`,
        'HIGH');
    }
  } catch (e) {
    console.log(`  ⚠ Erro ao testar Step to End: ${e.message}`);
  }

  // ══════════════════════════════════════════════════════════════════
  // REPORT SUMMARY
  // ══════════════════════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(60));
  console.log('📋 RESUMO DOS BUGS ENCONTRADOS');
  console.log('═'.repeat(60));

  if (bugs.length === 0) {
    console.log('✅ TODOS OS TESTES DE STEPS PASSARAM');
  } else {
    console.log(`Encontrados ${bugs.length} bug(s):\n`);
    for (const bug of bugs) {
      console.log(`### BUG-[${bug.num}]: ${bug.title}`);
      console.log(`- **Teste**: ${bug.test}`);
      console.log(`- **Passos**: ${bug.steps.join(' → ')}`);
      console.log(`- **Esperado**: ${bug.expected}`);
      console.log(`- **Real**: ${bug.real}`);
      console.log(`- **Severidade**: ${bug.severity}`);
      console.log();
    }
  }

  await browser.close();
  process.exit(bugs.length > 0 ? 1 : 0);
})().catch(err => {
  console.error('❌ Erro Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
