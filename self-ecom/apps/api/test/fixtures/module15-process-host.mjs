// Parent-side IPC helper shared by browser acceptance and independent scheduler processes.
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

export async function startModule15Process(options = {}) {
  const child = fork(fileURLToPath(new URL('./module15-api-process.mjs', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, ...options.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const pending = new Map(), events = new EventEmitter();
  let output = '', closed = false;
  child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-12000); });
  child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(-12000); });
  // Raw process output is deliberately private; callers must not print it because framework errors may contain configuration.
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Module15 API process ready timeout')), options.timeoutMs ?? 45000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Module15 API process could not start')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Module15 API process exited before ready')); });
    events.once('ready', value => { clearTimeout(timeout); resolve(value); });
  });
  child.on('message', message => {
    if (message.event) events.emit(message.event, message);
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id); pending.delete(message.id); clearTimeout(call.timeout);
      if (message.ok) call.resolve(message.result);
      else call.reject(Object.assign(new Error(message.error?.message ?? 'Module15 IPC failed'), { code: message.error?.code }));
    }
  });
  child.on('exit', () => {
    closed = true;
    for (const call of pending.values()) { clearTimeout(call.timeout); call.reject(new Error('Module15 API process exited during operation')); }
    pending.clear(); events.emit('closed');
  });
  const rpc = (op, payload = {}, timeoutMs = 180000) => new Promise((resolve, reject) => {
    if (closed || !child.connected) { reject(new Error('Module15 API process is closed')); return; }
    const id = randomUUID();
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Module15 IPC operation timeout: ' + op)); }, timeoutMs);
    pending.set(id, { resolve, reject, timeout }); child.send({ id, op, payload });
  });
  const waitFor = (event, predicate = () => true, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const listener = value => { if (!predicate(value)) return; clearTimeout(timeout); events.off(event, listener); resolve(value); };
    const timeout = setTimeout(() => { events.off(event, listener); reject(new Error('Module15 process event timeout: ' + event)); }, timeoutMs);
    events.on(event, listener);
  });
  try {
    const state = await ready;
    return { ...state, child, rpc, waitFor, privateOutput: () => output,
      async stop() {
        if (closed) return;
        const exited = waitFor('closed');
        await rpc('shutdown', {}, 30000); await exited;
      },
      async terminate() {
        if (closed) return;
        const exited = waitFor('closed'); child.kill(); await exited;
      },
    };
  } catch (error) { child.kill(); throw error; }
}
