const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK - Deep Investigation\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function expandEventLog() {
    // Click the Event Log toggle button to expand
    const toggle = page.locator('.event-log-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(300);
    }
  }

  async function getEventTypes() {
    const items = await page.locator('.event-log-entry .event-type').allTextContents();
    return items;
  }

  // Run default code
  console.log('Running default code...');
  const runBtn = page.locator('button:has-text("Run")');
  await runBtn.click();
  await page.waitForTimeout(1500);

  // Expand event log
  await expandEventLog();
  await page.waitForTimeout(300);

  const eventTypes = await getEventTypes();
  console.log('\nEvent types in order:', eventTypes);

  // Now let's step through one by one
  console.log('\n\n=== Stepping Forward ===\n');
  console.log('Step | Call Stack');
  console.log('-----|------------');

  // Reset
  const resetBtn = page.locator('button:has-text("Reset")');
  await resetBtn.click();
  await page.waitForTimeout(500);

  await runBtn.click();
  await page.waitForTimeout(1000);

  for (let i = 0; i < 12; i++) {
    const btn = page.locator('button[title="Step forward"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) {
      console.log(`${String(i+1).padStart(4)} | === AT END ===`);
      break;
    }
    await btn.click();
    await page.waitForTimeout(400);
    
    const stack = await getCallStackItems();
    const stackStr = stack.length > 0 ? `[${stack.join(' | ')}]` : '(empty)';
    console.log(`${String(i+1).padStart(4)} | ${stackStr}`);
  }

  console.log('\n\n=== Stepping Backward ===\n');
  for (let i = 0; i < 12; i++) {
    const btn = page.locator('button[title="Step back"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) {
      console.log(`${String(i+1).padStart(4)} | === AT BEGINNING ===`);
      break;
    }
    await btn.click();
    await page.waitForTimeout(400);
    
    const stack = await getCallStackItems();
    const stackStr = stack.length > 0 ? `[${stack.join(' | ')}]` : '(empty)';
    console.log(`${String(i+1).padStart(4)} | ${stackStr}`);
  }

  // Now let me try to type nested async functions
  console.log('\n\n=== Testing NESTED ASYNC functions ===\n');
  
  // Reset
  await resetBtn.click();
  await page.waitForTimeout(500);

  // Use a workaround to set the editor content
  // Click on editor and type
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.waitForTimeout(200);

  // Try to select all and replace
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);

  // Type new code - but CodeMirror might intercept this
  const nestedCode = `async function a() { await b(); }
async function b() { await c(); }
async function c() { return "done"; }
a();`;

  // Type character by character
  for (const char of nestedCode) {
    await page.keyboard.type(char, { delay: 0 });
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(500);

  const contentAfter = await cmContent.textContent();
  console.log('Editor content length:', contentAfter.length);
  console.log('Editor content starts with:', contentAfter.substring(0, 40));

  if (contentAfter.includes('async function a')) {
    console.log('SUCCESS: Nested async code was set!\n');
    
    // Run and observe
    await runBtn.click();
    await page.waitForTimeout(1500);

    await expandEventLog();
    const eventTypes2 = await getEventTypes();
    console.log('Event types:', eventTypes2);

    console.log('\nStepping forward:');
    for (let i = 0; i < 20; i++) {
      const btn = page.locator('button[title="Step forward"]');
      const isDisabled = await btn.isDisabled().catch(() => true);
      if (isDisabled) {
        console.log(`${String(i+1).padStart(4)} | === AT END ===`);
        break;
      }
      await btn.click();
      await page.waitForTimeout(400);
      
      const stack = await getCallStackItems();
      const stackStr = stack.length > 0 ? `[${stack.join(' | ')}]` : '(empty)';
      console.log(`${String(i+1).padStart(4)} | ${stackStr}`);
    }
  } else {
    console.log('FAILED: Editor still has old content');
    console.log('Content:', contentAfter.substring(0, 80));
  }

  await browser.close();
  console.log('\n✅ Complete');
})();
