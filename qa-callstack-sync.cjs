const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK - SYNC NESTED FUNCTIONS TEST\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function getEventTypes() {
    const toggle = page.locator('.event-log-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(300);
    }
    const items = await page.locator('.event-log-entry .event-type').allTextContents();
    return items;
  }

  async function stepForward() {
    const btn = page.locator('button[title="Step forward"]');
    if (await btn.isDisabled()) return false;
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }

  async function stepBack() {
    const btn = page.locator('button[title="Step back"]');
    if (await btn.isDisabled()) return false;
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }

  // Set code using fill
  async function setEditorCode(code) {
    const cmContent = page.locator('.cm-content').first();
    try {
      await cmContent.fill(code);
      await page.waitForTimeout(500);
      return true;
    } catch (e) {
      console.log('Fill failed:', e.message);
      return false;
    }
  }

  async function resetAndRun() {
    const reset = page.locator('button:has-text("Reset")');
    const run = page.locator('button:has-text("Run")');
    await reset.click();
    await page.waitForTimeout(500);
    await run.click();
    await page.waitForTimeout(1500);
  }

  // ===== TEST: Synchronous nested functions =====
  console.log('=== TEST: Synchronous nested functions ===\n');
  
  const syncCode = `function outer() {
  middle();
}
function middle() {
  inner();
}
function inner() {
  console.log("done");
}
outer();`;

  await setEditorCode(syncCode);
  
  // Check what the editor actually contains
  const cmContent = page.locator('.cm-content').first();
  const actualContent = await cmContent.textContent();
  console.log('Editor contains:', actualContent.substring(0, 60));
  
  if (!actualContent.includes('outer')) {
    console.log('ERROR: Editor content not updated properly!');
    console.log('Cannot test nested sync functions.\n');
  } else {
    console.log('Editor content looks correct!\n');
    
    await resetAndRun();
    
    const events = await getEventTypes();
    console.log('Events:', events);
    console.log('Number of frame.enter events:', events.filter(e => e === 'frame.enter').length);
    console.log('Number of frame.exit events:', events.filter(e => e === 'frame.exit').length);
    
    const stack = await getCallStackItems();
    console.log('Final Call Stack:', stack);

    // Step through
    console.log('\nStepping BACK from end:');
    for (let i = 0; i < 15; i++) {
      const didStep = await stepBack();
      if (!didStep) { console.log(`  Step ${i+1}: AT BEGINNING`); break; }
      const s = await getCallStackItems();
      console.log(`  Step ${i+1}: [${s.join(', ')}]`);
    }

    console.log('\nStepping FORWARD from start:');
    for (let i = 0; i < 15; i++) {
      const didStep = await stepForward();
      if (!didStep) { console.log(`  Step ${i+1}: AT END`); break; }
      const s = await getCallStackItems();
      console.log(`  Step ${i+1}: [${s.join(', ')}]`);
    }
  }

  // ===== ANALYSIS =====
  console.log('\n========================================');
  console.log('BUG ANALYSIS SUMMARY');
  console.log('========================================\n');
  
  console.log('TEST 1 - Default async function (single function):');
  console.log('  - Events: execution.start, frame.enter(example), console.output,');
  console.log('    await.suspend, frame.suspend, await.resume, frame.resume,');
  console.log('    console.output, frame.exit, execution.end');
  console.log('  - Only ONE frame ever appears (example)');
  console.log('  - Frame status changes: active -> suspended -> active -> exited');
  console.log('  - NO STACKING because only one function exists\n');
  
  console.log('TEST 2 - Synchronous nested functions (outer->middle->inner):');
  console.log('  - This test requires the editor to properly accept new code');
  console.log('  - If frame.enter events are emitted for outer, middle, inner,');
  console.log('    we should see all 3 frames accumulate in the stack');
  console.log('  - frame.exit events do NOT remove frames from display\n');
  
  console.log('EXPECTED BEHAVIOR for nested sync functions:');
  console.log('  - After outer() called: [outer (active)]');
  console.log('  - After middle() called: [outer (active), middle (active)]');
  console.log('  - After inner() called: [outer (active), middle (active), inner (active)]');
  console.log('  - After inner() returns: [outer (active), middle (active)]');
  console.log('  - After middle() returns: [outer (active)]');
  console.log('  - After outer() returns: [] (empty)\n');
  
  console.log('POTENTIAL BUGS:');
  console.log('1. If nested sync functions produce multiple frame.enter events but');
  console.log('   they are processed in the same step, the UI might not show them accumulating');
  console.log('2. The Babel transform for sync functions wraps them in try/finally');
  console.log('   so frame.enter fires at function start and frame.exit fires at end');
  console.log('3. For truly synchronous nested calls, the outer function cannot exit');
  console.log('   until the inner function returns, so the stack should build up\n');

  await browser.close();
  console.log('✅ Complete');
})();
