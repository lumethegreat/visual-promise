const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1000);

  // Run default code
  await page.locator('button:has-text("Run")').first().click();
  await page.waitForTimeout(2000);

  // Get full body HTML
  const html = await page.locator('body').innerHTML();
  console.log('=== BODY HTML (first 3000 chars) ===');
  console.log(html.substring(0, 3000));

  console.log('\n\n=== Searching for console/queue/stack elements ===');

  // Try different selectors
  const selectors = [
    'section', 'aside', 'div[class*="panel"]', 'div[class*="Panel"]',
    'div[class*="console"]', 'div[class*="Console"]',
    'div[class*="queue"]', 'div[class*="Queue"]',
    'div[class*="stack"]', 'div[class*="Stack"]',
    'div[class*="inspector"]', 'div[class*="output"]',
  ];

  for (const sel of selectors) {
    const els = await page.locator(sel).all();
    if (els.length > 0) {
      console.log(`\nSelector: ${sel} (${els.length} found)`);
      for (let i = 0; i < Math.min(els.length, 3); i++) {
        const visible = await els[i].isVisible().catch(() => false);
        const cls = await els[i].getAttribute('class').catch(() => '');
        const text = await els[i].innerText().catch(() => '');
        console.log(`  [${i}] cls="${cls}" | visible=${visible} | text="${text.substring(0, 100)}"`);
      }
    }
  }

  await browser.close();
})();
