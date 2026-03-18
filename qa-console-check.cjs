const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log('=== Verificando painel Console ===\n');

  // Clicar Run
  await page.locator('.btn-run').click();
  await page.waitForTimeout(2000);

  // Listar TODOS os painéis
  const panels = await page.locator('.panel').all();
  console.log(`Total de .panel: ${panels.length}`);
  for (let i = 0; i < panels.length; i++) {
    const cls = await panels[i].getAttribute('class');
    const text = await panels[i].textContent();
    const visible = await panels[i].isVisible();
    console.log(`[${i}] cls="${cls}" | visible=${visible} | text="${text.replace(/\n/g, '\\n').substring(0, 150)}"`);
  }

  // Tentar cada seletor possível
  const selectors = [
    '.console-panel',
    '.output-panel',
    '.event-log-inspector',
    '[class*="console"]',
    '[class*="Console"]',
    '[class*="output"]',
    '[class*="Output"]',
  ];

  for (const sel of selectors) {
    const els = await page.locator(sel).all();
    console.log(`\nSelector "${sel}": ${els.length} found`);
    for (const el of els) {
      const visible = await el.isVisible().catch(() => false);
      const text = await el.textContent().catch(() => '');
      console.log(`  visible=${visible} | "${text.replace(/\n/g, '\\n').substring(0, 150)}"`);
    }
  }

  // Verificar o inspector-pane completo
  const inspector = await page.locator('.inspector-pane').first();
  const inspectorHtml = await inspector.innerHTML();
  console.log('\n=== Inspector pane HTML ===');
  console.log(inspectorHtml.substring(0, 2000));

  await browser.close();
})();
