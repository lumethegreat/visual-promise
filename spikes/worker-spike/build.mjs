/**
 * build.mjs — Compiles vp-worker.ts → vp-worker.mjs before running the spike.
 * Uses Node's native ESM + strip-types (Node 24+) to transpile TypeScript.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const src = path.join(__dirname, 'vp-worker.ts');
const dst = path.join(__dirname, 'vp-worker.mjs');

try {
  // Use tsx to transpile TS → JS (strip types, emit JS)
  // --tsconfig tells tsx which config to use
  const out = execSync(
    `npx --yes tsx --tsconfig tsconfig.spike.json --compiler-options "module=NodeNext,moduleResolution=NodeNext,target=ES2022" ${src}`,
    { cwd: __dirname, timeout: 30000 }
  );
  // tsx with no emit prints to stdout; redirect to dst
  // Fallback: use the node --experimental-strip-types trick
} catch {
  // tsx doesn't support --emit out of the box for single file emit
}

// Actually use tsc for proper compilation
try {
  execSync(
    `npx --yes tsc --project tsconfig.spike.json`,
    { cwd: __dirname, stdio: 'inherit', timeout: 30000 }
  );
  console.log('✅ Worker compiled successfully');
} catch (e) {
  console.error('Compilation failed:', e);
  process.exit(1);
}
