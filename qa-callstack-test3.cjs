const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('🧪 CALL STACK DEEP INVESTIGATION\n');

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  async function getCallStackItems() {
    const items = await page.locator('.call-stack-panel li').allTextContents();
    return items;
  }

  async function getStepStatus() {
    const el = page.locator('[class*="step-controls"] .status, [class*="stepControls"]').first();
    return await el.textContent().catch(() => '?');
  }

  async function stepForward() {
    const btn = page.locator('button[title="Step forward"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) return false;
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }

  async function stepBack() {
    const btn = page.locator('button[title="Step back"]');
    const isDisabled = await btn.isDisabled().catch(() => true);
    if (isDisabled) return false;
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  }

  async function runCode(code) {
    // Use page.evaluate to set the CodeMirror content directly
    await page.evaluate((newCode) => {
      const cmContent = document.querySelector('.cm-content');
      if (cmContent) {
        // Get the CodeMirror view from the DOM
        const cmEditor = cmContent.closest('.cm-editor');
        const state = cmEditor?.cmView?.state || cmEditor?.CodeMirror?.state;
        
        // Try to get view state
        const view = window.__cm || window.__cm_view;
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newCode }
          });
        } else {
          // Fallback: directly set textContent and trigger input event
          cmContent.textContent = newCode;
          cmContent.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
      }
    }, code);
    await page.waitForTimeout(500);
    
    // Click Run
    const runBtn = page.locator('button:has-text("Run")');
    await runBtn.click();
    await page.waitForTimeout(1000);
  }

  // === TEST 1: Default code (simple async) ===
  console.log('=== TEST 1: Default code (simple async function) ===\n');
  
  let runBtn = page.locator('button:has-text("Run")');
  await runBtn.click();
  await page.waitForTimeout(1500);

  let stack = await getCallStackItems();
  console.log('After Run: ', stack);

  // Get total steps
  let stepText = await getStepStatus();
  console.log('Status: ', stepText);

  // Step through
  console.log('\nStepping forward:');
  for (let i = 0; i < 15; i++) {
    const didStep = await stepForward();
    if (!didStep) { console.log(`  Step ${i+1}: At end`); break; }
    const s = await getCallStackItems();
    console.log(`  Step ${i+1}: [${s.join(', ')}]`);
  }

  // Step back
  console.log('\nStepping back:');
  for (let i = 0; i < 15; i++) {
    const didStep = await stepBack();
    if (!didStep) { console.log(`  Step ${i+1}: At beginning`); break; }
    const s = await getCallStackItems();
    console.log(`  Step ${i+1}: [${s.join(', ')}]`);
  }

  // === TEST 2: Reset then try nested sync functions ===
  console.log('\n\n=== TEST 2: Nested SYNCHRONOUS functions ===\n');
  
  // Reset
  const resetBtn = page.locator('button:has-text("Reset")');
  await resetBtn.click();
  await page.waitForTimeout(500);

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

  // Try using keyboard directly 
  const cmContent = page.locator('.cm-content').first();
  await cmContent.click();
  await page.waitForTimeout(100);
  
  // Select all and delete
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  
  // Type the new code character by character
  await page.keyboard.type(syncCode, { delay: 2 });
  await page.waitForTimeout(500);

  // Verify what was typed
  const typedContent = await cmContent.textContent();
  console.log('Typed content:', typedContent.substring(0, 50) + '...');
  
  // Run
  await runBtn.click();
  await page.waitForTimeout(1500);

  stack = await getCallStackItems();
  console.log('After Run (sync nested): ', stack);

  stepText = await getStepStatus();
  console.log('Status: ', stepText);

  // Step through
  console.log('\nStepping forward:');
  for (let i = 0; i < 12; i++) {
    const didStep = await stepForward();
    if (!didStep) { console.log(`  Step ${i+1}: At end`); break; }
    const s = await getCallStackItems();
    console.log(`  Step ${i+1}: [${s.join(', ')}]`);
  }

  // === ANALYSIS ===
  console.log('\n\n=== BUG ANALYSIS ===\n');
  console.log('OBSERVED BEHAVIOR:');
  console.log('1. After execution completes, only the LAST function frame may be visible');
  console.log('2. Frames do not accumulate during nested synchronous calls');
  console.log('');
  console.log('EXPECTED BEHAVIOR:');
  console.log('1. During outer()->middle()->inner() execution, call stack should show:');
  console.log('   - After outer() called: [outer]');
  console.log('   - After middle() called: [outer, middle]');
  console.log('   - After inner() called: [outer, middle, inner]');
  console.log('   - After inner() returns: [outer, middle]');
  console.log('   - etc.');
  console.log('');
  console.log('ROOT CAUSE (likely):');
  console.log('The frame.enter events are fired but frame.exit events are also fired');
  console.log('immediately since the nested calls are synchronous. By the time the');
  console.log('reducer processes the events, the frameStack may not be accumulating.');
  console.log('');
  console.log('Actually, looking at the reducer:');
  console.log('- frame.enter ADDS to frameStack');
  console.log('- frame.exit only changes status to "exited" (does NOT remove)');
  console.log('So exited frames SHOULD persist in the display.');
  console.log('');
  console.log('The real question: are the frame.enter events even being emitted?');
  console.log('For sync functions, the enter/exit happen very fast in the same step.');

  await browser.close();
  console.log('\n✅ Investigation complete');
})();
