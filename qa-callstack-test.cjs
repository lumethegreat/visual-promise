const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK BUG INVESTIGATION\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);

  // Get the CodeMirror editor content element
  async function getEditorContent() {
    return await page.locator('.cm-content').first().textContent();
  }

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function stepForward() {
    const btn = page.locator('button[title="Step forward"]');
    if (await btn.isVisible() && !(await btn.isDisabled())) {
      await btn.click();
      await page.waitForTimeout(300);
    }
  }

  async function stepBack() {
    const btn = page.locator('button[title="Step back"]');
    if (await btn.isVisible() && !(await btn.isDisabled())) {
      await btn.click();
      await page.waitForTimeout(300);
    }
  }

  async function getStepIndicator() {
    return page.locator('.step-indicator, [class*="step"]').first().textContent().catch(() => '?');
  }

  // === TEST 1: Simple nested async functions ===
  console.log('=== TEST 1: Simple nested async functions ===\n');
  
  // Clear editor and type new code
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  const testCode1 = `async function a() { await b(); }
async function b() { await c(); }
async function c() { return "done"; }
a();`;

  await page.keyboard.type(testCode1, { delay: 10 });
  await page.waitForTimeout(500);

  const codeAfterTyping = await getEditorContent();
  console.log('Editor content after typing:', codeAfterTyping.substring(0, 80));
  
  // Click Run
  const runBtn = page.locator('button:has-text("Run")');
  await runBtn.click();
  await page.waitForTimeout(2000);

  console.log('\n--- Immediately after Run ---');
  console.log('Call Stack:', await getCallStackItems());
  
  // Step forward through the execution
  console.log('\n--- Stepping Forward ---');
  for (let i = 0; i < 15; i++) {
    const btn = page.locator('button[title="Step forward"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) {
      console.log(`Step ${i+1}: Step forward button DISABLED (at end)`);
      break;
    }
    await stepForward();
    const stack = await getCallStackItems();
    console.log(`Step ${i+1}: Call Stack = [${stack.join(', ')}]`);
  }

  // Reset
  console.log('\n--- Resetting ---');
  const resetBtn = page.locator('button:has-text("Reset")');
  await resetBtn.click();
  await page.waitForTimeout(500);

  // === TEST 2: Triple-nested synchronous functions ===
  console.log('\n\n=== TEST 2: Triple-nested synchronous functions ===\n');
  
  await cmContent.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);

  const testCode2 = `function outer() {
  middle();
}
function middle() {
  inner();
}
function inner() {
  console.log("done");
}
outer();`;

  await page.keyboard.type(testCode2, { delay: 10 });
  await page.waitForTimeout(500);

  await runBtn.click();
  await page.waitForTimeout(2000);

  console.log('\n--- Immediately after Run (sync nested) ---');
  console.log('Call Stack:', await getCallStackItems());
  
  // Step through
  console.log('\n--- Stepping Forward ---');
  for (let i = 0; i < 10; i++) {
    const btn = page.locator('button[title="Step forward"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) {
      console.log(`Step ${i+1}: Step forward button DISABLED (at end)`);
      break;
    }
    await stepForward();
    const stack = await getCallStackItems();
    console.log(`Step ${i+1}: Call Stack = [${stack.join(', ')}]`);
  }

  // === TEST 3: Check what SHOULD happen vs what DOES happen ===
  console.log('\n\n=== ANALYSIS ===\n');
  console.log('WHAT THE CALL STACK SHOULD SHOW:');
  console.log('  - When a() is called: [a (active)]');
  console.log('  - When a() calls b(): [a (active), b (active)]');
  console.log('  - When b() calls c(): [a (active), b (active), c (active)]');
  console.log('  - When c() returns: [a (active), b (active)]');
  console.log('  - When b() returns: [a (active)]');
  console.log('  - When a() returns: []');
  console.log('');
  console.log('WHAT THE CALL STACK ACTUALLY SHOWS:');
  const finalStack = await getCallStackItems();
  console.log('  - After full execution:', finalStack);
  console.log('');
  console.log('BUG: The call stack frames are NOT accumulating/building up as');
  console.log('     functions are called. They should show nested frames at each step.');

  await browser.close();
  console.log('\n✅ Test complete');
})();
