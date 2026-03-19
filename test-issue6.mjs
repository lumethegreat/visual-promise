import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => {
  console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
});

page.on('pageerror', err => {
  console.log(`[PAGE ERROR] ${err.message}`);
});

await page.goto('http://localhost:5173');
await page.waitForSelector('.cm-editor', { timeout: 10000 });

async function runTest(code, expectedError) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  await page.keyboard.type(code, { delay: 5 });
  await page.waitForTimeout(300);
  
  console.log(`\n>>> Code: "${code}"`);
  
  await page.locator('button:has-text("▶ Run")').click();
  
  // Wait for animation to finish
  await page.waitForFunction(() => {
    const el = document.querySelector('.step-indicator');
    return el && el.textContent?.includes('Step') && el.textContent?.includes('/');
  }, { timeout: 20000 }).catch(() => {});
  
  await page.waitForTimeout(500);
  
  // Check for error banner
  const bannerText = await page.locator('.banner-error, [class*="error"]').textContent().catch(() => '');
  if (bannerText) {
    console.log(`  BANNER: "${bannerText}"`);
  }
  
  // Check console panel
  await page.locator('button', { hasText: 'Console' }).click();
  await page.waitForTimeout(500);
  const entries = await page.locator('.console-entry').allTextContents();
  console.log(`  Console entries: ${JSON.stringify(entries)}`);
  
  // Check for transform error
  if (bannerText && bannerText.includes('Transform error')) {
    console.log(`  ❌ TRANSFORM ERROR FOUND!`);
    return false;
  }
  
  // Check if expected output is there
  if (expectedError) {
    const found = entries.some(e => e.includes(expectedError));
    console.log(`  Expected "${expectedError}" → ${found ? '✅ FOUND' : '❌ NOT FOUND'}`);
    return found;
  }
  
  console.log(`  ✅ OK`);
  return true;
}

// TEST 1: The exact bug case from issue #6
const result1 = await runTest(
  'Promise.reject("error!"); console.log("after");',
  'after'
);

// TEST 2: Promise.reject alone
const result2 = await runTest(
  'Promise.reject("boom");',
  'Unhandled'
);

// TEST 3: With .catch
const result3 = await runTest(
  'Promise.reject("error!").catch(e => console.log("caught:", e));',
  'caught:'
);

console.log(`\n=== RESULTS ===`);
console.log(`Test 1 (multi-statement Promise.reject): ${result1 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 2 (Promise.reject alone): ${result2 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 3 (Promise.reject with catch): ${result3 ? '✅ PASS' : '❌ FAIL'}`);

await browser.close();
process.exit(result1 && result2 && result3 ? 0 : 1);
