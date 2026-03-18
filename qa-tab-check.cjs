const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log('=== Verificando Console Tab Click ===\n');

  // Run default code
  await page.locator('.btn-run').click();
  await page.waitForTimeout(2000);

  // Click Console tab
  console.log('Clicando no tab Console...');
  await page.locator('.tab-bar .tab:has-text("Console")').click();
  await page.waitForTimeout(500);

  // Check tab-content now
  const tabContent = await page.locator('.tab-content').innerHTML();
  console.log('Tab content HTML:\n' + tabContent.substring(0, 1000));

  // Check for console panel now
  const consolePanelHtml = await page.locator('.panel.console-panel, .panel.output-panel, [class*="console"]').innerHTML().catch(() => 'NOT FOUND');
  console.log('\nConsole panel HTML: ' + consolePanelHtml.substring(0, 500));

  // Check for log items
  const logItems = await page.locator('.log-item, .console-item, [class*="log-item"], [class*="console-item"], [class*="entry"]').all();
  console.log(`Log items: ${logItems.length}`);
  for (const item of logItems) {
    const text = await item.textContent().catch(() => '');
    console.log(`  → "${text}"`);
  }

  // Also check event-log-inspector
  const eventLog = await page.locator('.event-log-inspector').first();
  const eventLogVisible = await eventLog.isVisible().catch(() => false);
  const eventLogText = await eventLog.textContent().catch(() => '');
  console.log(`\nEvent Log visible: ${eventLogVisible}`);
  console.log(`Event Log text: "${eventLogText}"`);

  // Check Queue tab too
  console.log('\nClicando no tab Queue...');
  await page.locator('.tab-bar .tab:has-text("Queue")').click();
  await page.waitForTimeout(500);
  const queueContent = await page.locator('.tab-content').innerHTML();
  console.log('Queue content HTML:\n' + queueContent.substring(0, 1000));

  await browser.close();
})();
