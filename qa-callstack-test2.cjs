const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK DEEP INVESTIGATION - Step by Step\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function getCurrentStep() {
    const text = await page.locator('[class*="step-indicator"], .step-indicator, [class*="status"]').first().textContent().catch(() => '?');
    return text;
  }

  async function stepForward() {
    const btn = page.locator('button[title="Step forward"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) return false;
    await btn.click();
    await page.waitForTimeout(300);
    return true;
  }

  async function stepBack() {
    const btn = page.locator('button[title="Step back"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) return false;
    await btn.click();
    await page.waitForTimeout(300);
    return true;
  }

  async function getEventLogCount() {
    const btn = page.locator('button[href*="event"], button:has-text("Event Log")');
    if (await btn.isVisible()) {
      const text = await btn.textContent();
      const match = text.match(/\d+/);
      return match ? parseInt(match[0]) : 0;
    }
    return 0;
  }

  async function runCode(code) {
    const cmContent = page.locator('.cm-content').first();
    await cmContent.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type(code, { delay: 5 });
    await page.waitForTimeout(300);
    
    const runBtn = page.locator('button:has-text("Run")');
    await runBtn.click();
    await page.waitForTimeout(500);
  }

  // === TEST: Triple-nested synchronous functions ===
  console.log('=== TEST: Triple-nested SYNCHRONOUS functions ===\n');
  
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

  await runCode(syncCode);
  await page.waitForTimeout(1000);

  const totalSteps = await getEventLogCount();
  console.log(`Total events: ${totalSteps}`);
  console.log(`Initial Call Stack: ${JSON.stringify(await getCallStackItems())}\n`);

  // Step back to beginning
  console.log('--- Stepping BACK to start ---');
  for (let i = 0; i < 15; i++) {
    const didStep = await stepBack();
    if (!didStep) { console.log('At beginning'); break; }
    const stack = await getCallStackItems();
    console.log(`After step back: [${stack.join(', ')}]`);
  }

  console.log('\n--- Stepping FORWARD from start ---');
  for (let i = 0; i < 15; i++) {
    const didStep = await stepForward();
    if (!didStep) { console.log('At end'); break; }
    const stack = await getCallStackItems();
    console.log(`Step ${i+1}: [${stack.join(', ')}]`);
  }

  // === TEST 2: Async nested functions ===
  console.log('\n\n=== TEST: Triple-nested ASYNC functions ===\n');
  
  const asyncCode = `async function a() {
  await b();
}
async function b() {
  await c();
}
async function c() {
  console.log("done");
}
a();`;

  await runCode(asyncCode);
  await page.waitForTimeout(1000);

  const totalSteps2 = await getEventLogCount();
  console.log(`Total events: ${totalSteps2}`);
  console.log(`Initial Call Stack (after run): ${JSON.stringify(await getCallStackItems())}\n`);

  // Step back to beginning
  console.log('--- Stepping BACK to start ---');
  for (let i = 0; i < 20; i++) {
    const didStep = await stepBack();
    if (!didStep) { console.log('At beginning'); break; }
    const stack = await getCallStackItems();
    console.log(`After step back: [${stack.join(', ')}]`);
  }

  console.log('\n--- Stepping FORWARD from start ---');
  for (let i = 0; i < 25; i++) {
    const didStep = await stepForward();
    if (!didStep) { console.log('At end'); break; }
    const stack = await getCallStackItems();
    console.log(`Step ${i+1}: [${stack.join(', ')}]`);
  }

  // === ANALYSIS ===
  console.log('\n\n=== FINDINGS ===\n');
  console.log('SYNC NESTED FUNCTIONS (outer→middle→inner):');
  console.log('  - Expected: frames should accumulate as nested calls happen');
  console.log('  - Actual: Need to observe step-by-step behavior above');
  console.log('');
  console.log('ASYNC NESTED FUNCTIONS (a→b→c):');
  console.log('  - Expected: frames should accumulate when awaiting');
  console.log('  - Actual: Need to observe step-by-step behavior above');

  await browser.close();
  console.log('\n✅ Investigation complete');
})();
