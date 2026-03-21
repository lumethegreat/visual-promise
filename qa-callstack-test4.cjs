const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK - Event Log Investigation\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function clickEventLog() {
    const btn = page.locator('button:has-text("Event Log")');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(500);
    }
  }

  async function getEventLogItems() {
    // Find all events in the event log panel
    const items = await page.locator('[class*="event-log"] li, [class*="event-log"] *').allTextContents();
    return items.slice(0, 50); // First 50 items
  }

  // Run default code
  console.log('Running default code...');
  const runBtn = page.locator('button:has-text("Run")');
  await runBtn.click();
  await page.waitForTimeout(1500);

  // Click Event Log button to see events
  await clickEventLog();
  await page.waitForTimeout(500);

  // Get event log
  const eventLogText = await page.locator('[class*="event-log"]').textContent().catch(() => 'Not found');
  console.log('\nEvent Log (first 2000 chars):');
  console.log(eventLogText.substring(0, 2000));

  // Check step controls state
  const stepForward = page.locator('button[title="Step forward"]');
  const isDisabled = await stepForward.isDisabled().catch(() => true);
  console.log(`\nStep forward disabled: ${isDisabled}`);

  // Now let's see what happens step by step
  console.log('\n\n=== Stepping through execution ===\n');

  // Go back to step 0
  const resetBtn = page.locator('button:has-text("Reset")');
  await resetBtn.click();
  await page.waitForTimeout(500);

  await runBtn.click();
  await page.waitForTimeout(1500);

  // Step forward one at a time and observe Call Stack
  console.log('Step | Call Stack');
  console.log('-----|------------');

  for (let i = 0; i < 15; i++) {
    const btn = page.locator('button[title="Step forward"]');
    const isStillDisabled = await btn.isDisabled().catch(() => true);
    if (isStillDisabled) {
      console.log(`${String(i+1).padStart(4)} | At end`);
      break;
    }
    await btn.click();
    await page.waitForTimeout(400);
    
    const stack = await getCallStackItems();
    const stackStr = stack.length > 0 ? `[${stack.join(', ')}]` : '(empty)';
    console.log(`${String(i+1).padStart(4)} | ${stackStr}`);
  }

  // Go back and check Event Log
  console.log('\n\n=== Going back to step 0 and checking ===\n');
  
  // Step back multiple times
  for (let i = 0; i < 10; i++) {
    const btn = page.locator('button[title="Step back"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) break;
    await btn.click();
    await page.waitForTimeout(300);
  }

  const stackAtStart = await getCallStackItems();
  console.log('Call Stack at step 0:', stackAtStart);

  // Now check what events we have
  await clickEventLog();
  const events = await getEventLogItems();
  console.log('\nFirst 20 events:', events.slice(0, 20));

  await browser.close();
  console.log('\n✅ Complete');
})();
