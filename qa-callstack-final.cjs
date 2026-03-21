const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK FINAL INVESTIGATION\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function getEventTypes() {
    const toggle = page.locator('.event-log-toggle');
    if (await toggle.isVisible()) {
      const isCollapsed = await toggle.textContent().then(t => t.includes('▶'));
      if (isCollapsed) {
        await toggle.click();
        await page.waitForTimeout(300);
      }
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

  async function resetAndRun() {
    const reset = page.locator('button:has-text("Reset")');
    const run = page.locator('button:has-text("Run")');
    await reset.click();
    await page.waitForTimeout(500);
    await run.click();
    await page.waitForTimeout(1500);
  }

  // ===== TEST 1: Default code (simple async function) =====
  console.log('=== TEST 1: Default async function ===\n');
  
  await resetAndRun();
  
  const events1 = await getEventTypes();
  console.log('Events:', events1);
  
  const stack1 = await getCallStackItems();
  console.log('Final Call Stack:', stack1);

  // Step through backward
  console.log('\nStepping BACK from end:');
  let frames = [];
  for (let i = 0; i < 12; i++) {
    const didStep = await stepBack();
    if (!didStep) { console.log(`  Step ${i+1}: AT BEGINNING`); break; }
    const s = await getCallStackItems();
    const status = s.length > 0 ? `[${s.join(', ')}]` : '(empty)';
    console.log(`  Step ${i+1}: ${status}`);
    frames.push(s);
  }

  // Step through forward
  console.log('\nStepping FORWARD from start:');
  for (let i = 0; i < 12; i++) {
    const didStep = await stepForward();
    if (!didStep) { console.log(`  Step ${i+1}: AT END`); break; }
    const s = await getCallStackItems();
    const status = s.length > 0 ? `[${s.join(', ')}]` : '(empty)';
    console.log(`  Step ${i+1}: ${status}`);
  }

  // ===== TEST 2: Try to set nested async code =====
  console.log('\n\n=== TEST 2: Nested async functions (a->b->c) ===\n');

  // Method: Use React to set the code state directly
  const setCodeResult = await page.evaluate(() => {
    // Try to find the React root and set state
    const root = document.querySelector('#root')?.['_reactRootContainer'];
    if (!root) return 'No React root found';
    
    // Try accessing via window (if there's a global)
    const stateSetter = window.__setCode;
    if (stateSetter) {
      stateSetter(`async function a() { await b(); }
async function b() { await c(); }
async function c() { return "done"; }
a();`);
      return 'Set via window.__setCode';
    }
    
    // Try finding the App's setCode through React Fiber
    const rootElement = document.getElementById('root');
    const internalRoot = rootElement?.__reactFiber || rootElement?._reactRootContainer?._internalRoot;
    if (internalRoot) {
      // Try to traverse to find the state setter
      // This is fragile but might work
      return 'Found React Fiber but cannot easily set state';
    }
    
    return 'Could not find way to set code';
  });
  
  console.log('Setting code result:', setCodeResult);
  
  // Try clicking on the cm-content and using keyboard
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.waitForTimeout(200);
  
  // Select all
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(100);
  
  // Try to fill using Playwright fill (if the element supports it)
  try {
    await cmContent.fill(`async function a() {
  await b();
}
async function b() {
  await c();
}
async function c() {
  return "done";
}
a();`);
    console.log('Fill succeeded');
  } catch (e) {
    console.log('Fill failed:', e.message);
  }
  
  await page.waitForTimeout(500);
  
  const content = await cmContent.textContent();
  console.log('Editor content after fill:', content.substring(0, 60));
  
  // If we have the right code, run it
  if (content.includes('async function a')) {
    console.log('\nRunning nested async code...');
    await resetAndRun();
    
    const events2 = await getEventTypes();
    console.log('Events:', events2);
    
    const stack2 = await getCallStackItems();
    console.log('Final Call Stack:', stack2);
    
    console.log('\nStepping through:');
    for (let i = 0; i < 25; i++) {
      const didStep = await stepForward();
      if (!didStep) { console.log(`  Step ${i+1}: AT END`); break; }
      const s = await getCallStackItems();
      const status = s.length > 0 ? `[${s.join(', ')}]` : '(empty)';
      console.log(`  Step ${i+1}: ${status}`);
    }
  } else {
    console.log('\nCould not set nested async code. The fill method did not work with CodeMirror.');
    console.log('Let me try another approach...\n');
    
    // Try clicking somewhere else and typing
    const cmEditor = page.locator('.cm-editor').first();
    await cmEditor.click();
    await page.waitForTimeout(200);
    
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    
    // Try typing
    await page.keyboard.type('async function a() { await b(); }', { delay: 5 });
    await page.waitForTimeout(300);
    
    const content2 = await cmContent.textContent();
    console.log('After typing:', content2.substring(0, 60));
  }

  // ===== ANALYSIS =====
  console.log('\n\n========================================');
  console.log('BUG ANALYSIS: CALL STACK NOT STACKING');
  console.log('========================================\n');
  
  console.log('OBSERVATIONS:');
  console.log('1. The default async function example() only produces ONE frame.enter event');
  console.log('2. Therefore, the call stack never shows multiple frames accumulating');
  console.log('3. The frame lifecycle is: enter -> suspend -> resume -> exit');
  console.log('4. But only ONE frame is ever visible at a time in the Call Stack panel\n');
  
  console.log('WHAT THE BUG REPORT SAYS:');
  console.log('"The call stack is not showing properly - they don\'t see the call stack');
  console.log('"stacking" (building up/accumulating) as it should."\n');
  
  console.log('LIKELY ROOT CAUSE:');
  console.log('The test case used by the user may have been a single async function with');
  console.log('just an "await Promise.resolve()" - which creates only ONE frame.');
  console.log('With such code, there is nothing TO stack - only one function exists.');
  console.log('');
  console.log('However, if the user expected to see the internal async machinery');
  console.log('represented as stack frames, that would be a different expectation.');
  console.log('');
  console.log('Another possibility: if the code DOES have nested async calls like');
  console.log('a()->b()->c(), and only one frame shows, then the frame.enter events');
  console.log('may not be emitted properly for the inner functions.\n');
  
  console.log('RECOMMENDATION FOR USER:');
  console.log('1. Try running code with ACTUALLY NESTED FUNCTION CALLS:');
  console.log('   function a() { b(); }');
  console.log('   function b() { c(); }');
  console.log('   function c() { console.log("done"); }');
  console.log('   a();');
  console.log('');
  console.log('2. Or with nested async functions:');
  console.log('   async function a() { await b(); }');
  console.log('   async function b() { await c(); }');
  console.log('   async function c() { return "done"; }');
  console.log('   a();');
  console.log('');
  console.log('3. Then step through and observe if MULTIPLE frames appear at once.\n');

  await browser.close();
  console.log('✅ Investigation complete');
})();
