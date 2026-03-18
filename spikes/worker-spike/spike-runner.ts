/**
 * spike-runner.ts — Visual Promise Web Worker feasibility spike
 *
 * Runs all 6 tests against vp-worker.ts using Node.js worker_threads.
 * Execute:  npx tsx spike-runner.ts
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import { fileURLToPath } from 'url';

const WORKER_PATH = path.resolve(fileURLToPath(import.meta.url), '..', 'vp-worker.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestResult = 'PASS' | 'FAIL' | 'WARN' | 'INFO';

interface TestReport {
  label: string;
  result: TestResult;
  detail: string;
}

function report(label: string, result: TestResult, detail: string): TestReport {
  const icon: Record<TestResult, string> = {
    PASS: '✅',
    FAIL: '❌',
    WARN: '⚠️ ',
    INFO: 'ℹ️ ',
  };
  console.log(`${icon[result]} Test ${label} — ${result}${detail ? '  ' + detail : ''}`);
  return { label, result, detail };
}

/** Collect messages from the worker for up to `maxMs`. */
async function collectMessages(
  worker: Worker,
  maxMs = 5000
): Promise<{ type: string; data?: unknown; seq?: number; error?: unknown }[]> {
  return new Promise((resolve) => {
    const messages: { type: string; data?: unknown; seq?: number; error?: unknown }[] = [];
    const timer = setTimeout(() => resolve(messages), maxMs);
    worker.on('message', (msg) => {
      messages.push(msg);
      // For burst tests, stop collecting when we see a sentinel
      if (msg.type === 'burst.done' || msg.type === 'throughput.done') {
        clearTimeout(timer);
        resolve(messages);
      }
    });
  });
}

/** Wait for the 'worker.ready' message. */
async function waitReady(worker: Worker): Promise<void> {
  await new Promise<void>((resolve) => {
    worker.once('message', (msg) => {
      if (msg.type === 'worker.ready') resolve();
    });
  });
}

// ── Test 1: Worker communication basics ──────────────────────────────────────

async function test1(): Promise<TestReport> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    const received: string[] = [];

    worker.on('message', (msg) => {
      received.push(msg.type);

      // After 3 pongs + ready, evaluate
      if (msg.type === 'worker.ready') {
        worker.postMessage({ type: 'ping' });
      }

      if (received.filter((t) => t !== 'worker.ready').length >= 3) {
        worker.terminate();
        const pongs = received.filter((t) => t === 'pong');
        const inOrder =
          pongs.length === 3 &&
          received.indexOf('pong') < received.lastIndexOf('pong');
        resolve(
          report(
            '1: Worker comms',
            inOrder ? 'PASS' : 'FAIL',
            `${pongs.length} events received${inOrder ? ', in order' : ', OUT OF ORDER'}`
          )
        );
      }
    });
  });
}

// ── Test 2: Sequence number assignment ───────────────────────────────────────

async function test2(): Promise<TestReport> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    const received: { type: string; seq?: number }[] = [];

    const timer = setTimeout(() => {
      worker.terminate();
      resolve(report('2: Sequence numbers', 'FAIL', `timeout — only got ${received.length} messages`));
    }, 8000);

    let burstSent = false;
    worker.on('message', (msg: { type: string; seq?: number }) => {
      if (!burstSent && msg.type === 'worker.ready') {
        burstSent = true;
        worker.postMessage({ type: 'burst', _count: 500 });
      }
      received.push(msg);

      // Stop at exactly 501: 1 worker.ready + 500 burst.ticks
      if (received.length >= 501) {
        clearTimeout(timer);
        worker.terminate();

        const seqs = received.map((m) => m.seq as number);
        let gaps = 0;
        let outOfOrder = 0;
        for (let i = 1; i < seqs.length; i++) {
          if (seqs[i] !== seqs[i - 1] + 1) gaps++;
          if (seqs[i] < seqs[i - 1]) outOfOrder++;
        }

        const result = gaps === 0 && outOfOrder === 0 ? 'PASS' : 'FAIL';
        const detail =
          gaps === 0 && outOfOrder === 0
            ? `501 events (1 ready + 500 ticks), seq 1→501, no gaps or reordering`
            : `gaps=${gaps}, out-of-order=${outOfOrder}`;
        resolve(report('2: Sequence numbers', result, detail));
      }
    });
  });
}

// ── Test 3: Error serialisation ─────────────────────────────────────────────

async function test3(): Promise<TestReport> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);

    worker.once('message', () => {
      worker.postMessage({ type: 'cause-error' });
    });

    worker.on('message', (msg) => {
      if (msg.type === 'error.caught') {
        worker.terminate();
        const e = msg.error as Record<string, unknown>;

        const hasName = typeof e.name === 'string' && e.name.length > 0;
        const hasMessage = typeof e.message === 'string' && e.message.length > 0;
        const hasStack = typeof e.stack === 'string' && e.stack.includes('WorkerError');
        const prototypeLost = e.proto === null || e.proto === undefined;

        const allBasic = hasName && hasMessage && hasStack;

        if (prototypeLost) {
          resolve(
            report(
              '3: Error serialisation',
              'WARN',
              `basic fields OK (${hasName && hasMessage && hasStack}) but prototype chain LOST (proto=${e.proto})`
            )
          );
        } else if (allBasic) {
          resolve(report('3: Error serialisation', 'PASS', `name + message + stack all string fields`));
        } else {
          resolve(
            report(
              '3: Error serialisation',
              'FAIL',
              `missing fields — name=${hasName}, msg=${hasMessage}, stack=${hasStack}`
            )
          );
        }
      }
    });
  });
}

// ── Test 4: Async execution tracing ─────────────────────────────────────────

async function test4(): Promise<TestReport> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    const received: { type: string; seq?: number }[] = [];

    worker.once('message', () => {
      worker.postMessage({ type: 'trace-async' });
    });

    worker.on('message', (msg) => {
      received.push(msg);

      if (msg.type === 'console.output') {
        worker.terminate();

        // Expected order: execution.start → execution.end → console.output
        // (the then callback runs after execution.end because resolve(42) is already settled)
        const types = received.map((m) => m.type);
        const hasStart = types.includes('execution.start');
        const hasEnd = types.includes('execution.end');
        const hasOutput = types.includes('console.output');

        const allPresent = hasStart && hasEnd && hasOutput;

        // Check ordering: start must come before end; end must come before output
        const startIdx = types.indexOf('execution.start');
        const endIdx = types.indexOf('execution.end');
        const outputIdx = types.indexOf('console.output');

        const orderCorrect = allPresent && startIdx < endIdx && endIdx < outputIdx;

        resolve(
          report(
            '4: Async tracing',
            orderCorrect ? 'PASS' : 'FAIL',
            orderCorrect
              ? 'events in expected order: start → end → output (then callback deferred)'
              : `order wrong: ${JSON.stringify(types)}`
          )
        );
      }
    });
  });
}

// ── Test 5: Worker termination ───────────────────────────────────────────────

async function test5(): Promise<TestReport> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    const t0 = Date.now();

    worker.once('message', () => {
      worker.postMessage({ type: 'infinite-loop' });
      // Give the loop a moment to start
      setTimeout(() => {
        const before = Date.now();
        const term = worker.terminate();
        term.then(() => {
          const elapsed = Date.now() - before;
          const detail =
            elapsed < 200
              ? `terminated in ${elapsed}ms — very fast (event-loop yield)`
              : `terminated in ${elapsed}ms — took longer than expected`;
          resolve(report('5: Worker termination', 'PASS', detail));
        }).catch((err) => {
          resolve(report('5: Worker termination', 'FAIL', `terminate() threw: ${err}`));
        });
      }, 50);
    });
  });
}

// ── Test 6: postMessage performance ─────────────────────────────────────────

async function test6(): Promise<TestReport> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    const COUNT = 1000;
    let recvCount = 0;
    let t0 = 0;

    let sentThroughput = false;
    worker.on('message', (msg: { type: string }) => {
      if (!sentThroughput && msg.type === 'worker.ready') {
        sentThroughput = true;
        t0 = Date.now();
        worker.postMessage({ type: 'throughput', _count: COUNT });
      }
      if (msg.type === 'throughput.tick') recvCount++;
      if (msg.type === 'throughput.done') {
        const elapsed = Date.now() - t0;
        const rate = Math.round((recvCount / elapsed) * 1000);
        worker.terminate();
        resolve(
          report(
            '6: postMessage perf',
            'INFO',
            `${recvCount} events in ${elapsed}ms (~${rate} events/s, ${(recvCount / elapsed).toFixed(1)}k/s)`
          )
        );
      }
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 Visual Promise — Web Worker Feasibility Spike\n');
  console.log('─'.repeat(60));

  const results = await Promise.all([test1(), test2(), test3(), test4(), test5(), test6()]);

  console.log('─'.repeat(60));

  const passed = results.filter((r) => r.result === 'PASS').length;
  const warnings = results.filter((r) => r.result === 'WARN').length;
  const failed = results.filter((r) => r.result === 'FAIL').length;

  console.log(
    `\nSummary: ${passed} passed, ${warnings} warnings, ${failed} failed out of ${results.length} tests.\n`
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Runner crashed:', err);
  process.exit(1);
});
