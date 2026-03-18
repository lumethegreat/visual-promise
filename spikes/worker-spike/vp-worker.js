/**
 * vp-worker.ts — Visual Promise Web Worker spike
 *
 * Uses `worker_threads` (Node.js) which mirrors the browser Worker message-passing model.
 * Key mappings:
 *   browser self.postMessage  →  parentPort.postMessage
 *   browser self.onmessage    →  parentPort.on('message')
 *   browser self.close()      →  parentPort.close()
 *   browser self.importScripts → NOT supported (Node.js has require/import)
 */
import { parentPort, threadId } from 'worker_threads';
// ── __vp runtime ──────────────────────────────────────────────────────────────
const __vp = {
    seq: 0,
    post(event) {
        const envelope = { ...event, seq: ++this.seq, _thread: threadId };
        parentPort.postMessage(envelope);
    },
    createPromise(id) {
        this.post({ type: 'promise.create', data: { id } });
    },
    settle(id, status, value) {
        this.post({ type: 'promise.settle', data: { id, status, value } });
    },
    registerReaction(promiseId, handlerType) {
        this.post({ type: 'reaction.register', data: { promiseId, handlerType } });
    },
    reactionRun(reactionId) {
        this.post({ type: 'reaction.run', data: { reactionId } });
    },
};
// ── Message handler ───────────────────────────────────────────────────────────
parentPort.on('message', (msg) => {
    switch (msg.type) {
        // ── Test 1: basic round-trip ─────────────────────────────────────────────
        case 'ping': {
            __vp.post({ type: 'pong', data: { round: 1 } });
            __vp.post({ type: 'pong', data: { round: 2 } });
            __vp.post({ type: 'pong', data: { round: 3 } });
            break;
        }
        // ── Test 2: sequence numbers under load ─────────────────────────────────
        case 'burst': {
            const count = msg._count ?? 500;
            for (let i = 1; i <= count; i++) {
                __vp.post({ type: 'burst.tick', data: { i } });
            }
            break;
        }
        // ── Test 3: error serialisation ──────────────────────────────────────────
        case 'cause-error': {
            try {
                throw new Error('WorkerError: intentional failure in thread ' + threadId);
            }
            catch (err) {
                const e = err;
                // postMessage structured-clones Error objects into plain objects
                parentPort.postMessage({
                    type: 'error.caught',
                    seq: ++__vp.seq,
                    error: {
                        name: e.name,
                        message: e.message,
                        stack: e.stack,
                        constructorName: e.constructor.name,
                        // Check if prototype chain survives the clone
                        proto: Object.getPrototypeOf(e)?.constructor?.name ?? null,
                    },
                });
            }
            break;
        }
        // ── Test 4: async execution tracing ──────────────────────────────────────
        case 'trace-async': {
            __vp.post({ type: 'execution.start', data: {} });
            const p = Promise.resolve(42);
            p.then((v) => __vp.post({ type: 'console.output', data: { value: v } }));
            __vp.post({ type: 'execution.end', data: {} });
            break;
        }
        // ── Test 5: worker termination ──────────────────────────────────────────
        case 'infinite-loop': {
            // Busy-wait — no exit.  The runner will call worker.terminate() after 1 s.
            while (true) {
                // spin
            }
        }
        // ── Test 6: postMessage throughput ───────────────────────────────────────
        case 'throughput': {
            const count = msg._count ?? 1000;
            const t0 = Date.now();
            for (let i = 1; i <= count; i++) {
                __vp.post({ type: 'throughput.tick', data: { i } });
            }
            const elapsed = Date.now() - t0;
            __vp.post({ type: 'throughput.done', data: { count, elapsed } });
            break;
        }
        default:
            __vp.post({ type: 'unknown-command', data: { received: msg } });
    }
});
// Signal ready
__vp.post({ type: 'worker.ready', data: { threadId } });
