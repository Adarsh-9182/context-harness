import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as shared from '../dist/shared.mjs';

const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');

function harness({ stored, storageFails = false, fetchImpl } = {}) {
  const nodes = new Map();
  let saved = stored ? JSON.stringify(stored) : null;
  const element = selector => {
    if (selector === '#main [aria-invalid="true"]') return null;
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', open: false, listeners: {},
      classList: { add() {}, remove() {} },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      showModal() { this.open = true; }, close() { this.open = false; },
      focus() {}, reportValidity() {}, setCustomValidity() {}, setAttribute() {}, removeAttribute() {},
      scrollIntoView() {}, replaceChildren() { this.innerHTML = ''; },
    });
    return nodes.get(selector);
  };
  const document = { querySelector: element, querySelectorAll: () => [], addEventListener() {}, body: { classList: { add() {}, remove() {} } } };
  const context = vm.createContext({ ...shared, importRole: value => shared.importRole(structuredClone(value)), validateRole: value => shared.validateRole(structuredClone(value)), createRole: value => shared.createRole(structuredClone(value)), document, location: { hostname: 'example.test' }, localStorage: {
    getItem: () => saved,
    setItem(key, value) { if (storageFails) throw Error('quota'); saved = value; },
  }, window: { scrollTo() {} }, crypto: { randomUUID }, TextEncoder, TextDecoder, structuredClone,
  AbortController, AbortSignal, setTimeout: () => 1, clearTimeout() {}, console,
  fetch: fetchImpl ?? (() => { throw Error('Unexpected network call'); }),
  });
  vm.runInContext(`${source}\n globalThis.appTest = { validSession, parseWorkspace, confirmWorkspaceImport, applyWorkspaceImport, readKnowledge, addDocuments, startSession, renderChat, sendChat, boundedHistory, getState:()=>state, setState:s=>state=s, getPending:()=>pendingWorkspace, setRuntime:r=>runtime=r, setRunning:r=>running=r };`, context);
  return { api: context.appTest, element, nodes, saved: () => saved };
}

function session() {
  const snapshot = structuredClone(shared.BUILTIN_ROLES[0]);
  return { id: randomUUID(), roleId: snapshot.id, snapshot, memory: '', messages: [], createdAt: new Date().toISOString() };
}

test('session restore validates native UUIDs, matching role snapshots and UTF-8 memory', () => {
  const { api } = harness(); const valid = session();
  assert.equal(api.validSession(valid), true);
  assert.equal(api.validSession({ ...valid, id: '-'.repeat(36) }), false);
  assert.equal(api.validSession({ ...valid, roleId: 'teacher' }), false);
  assert.equal(api.validSession({ ...valid, messages: [null] }), false);
  assert.equal(api.validSession({ ...valid, memory: 'ह'.repeat(10_000) }), false);
  assert.equal(api.validSession({ ...valid, createdAt: 'not a date' }), false);
});

test('workspace import requires review and duplicate sessions are rejected', () => {
  const { api, element } = harness();
  const original = api.getState();
  const imported = api.parseWorkspace({ ...shared.createInitialState(), sessions: [session()] });
  api.confirmWorkspaceImport(imported);
  assert.equal(api.getState(), original);
  assert.equal(api.getPending(), imported);
  assert.match(element('#modal').innerHTML, /Replace workspace/);
  assert.match(element('#modal').innerHTML, /Export current/);
  api.applyWorkspaceImport();
  assert.equal(api.getState(), imported);
  assert.equal(api.getPending(), null);
  const duplicate = session();
  assert.throws(() => api.parseWorkspace({ ...shared.createInitialState(), sessions: [duplicate, duplicate] }), /duplicate sessions/);
});

test('workspace replacement keeps current data if storage fails or a response is running', () => {
  const { api } = harness({ storageFails: true });
  const original = api.getState();
  api.confirmWorkspaceImport(api.parseWorkspace(shared.createInitialState()));
  api.applyWorkspaceImport();
  assert.equal(api.getState(), original);
  const second = harness();
  const originalSecond = second.api.getState();
  second.api.confirmWorkspaceImport(second.api.parseWorkspace(shared.createInitialState()));
  second.api.setRunning({ id: randomUUID() });
  second.api.applyWorkspaceImport();
  assert.equal(second.api.getState(), originalSecond);
});

test('async reference upload stays with its original role after navigation', async () => {
  const { api } = harness();
  const state = api.getState();
  let resolveText;
  const pending = api.readKnowledge([{ name: 'notes.txt', size: 4, text: () => new Promise(resolve => resolveText = resolve) }], 'engineer');
  state.activeRoleId = 'teacher';
  resolveText('test');
  await pending;
  assert.equal(state.roles.find(r => r.id === 'engineer').knowledge[0].content, 'test');
  assert.equal(state.roles.find(r => r.id === 'teacher').knowledge.length, 0);
});

test('each new conversation snapshots its role and honors disabled memory', () => {
  const { api } = harness();
  const state = api.getState(); state.memories.engineer = 'Saved goals';
  api.startSession();
  const first = state.sessions[0];
  const role = state.roles.find(r => r.id === 'engineer');
  role.instructions = 'Changed instructions'; role.memoryEnabled = false;
  api.startSession();
  assert.notEqual(first.snapshot.instructions, role.instructions);
  assert.equal(first.memory, 'Saved goals');
  assert.equal(state.sessions[1].memory, '');
});

test('a running response disables only its own composer', () => {
  const { api } = harness(); const state = api.getState();
  const one = session(), two = session(); state.sessions = [one, two]; state.activeSessionId = two.id;
  api.setRunning({ id: one.id });
  assert.doesNotMatch(api.renderChat(), /maxlength="24000" disabled/);
  state.activeSessionId = one.id;
  assert.match(api.renderChat(), /maxlength="24000" disabled/);
});

test('a failed turn preserves the prompt as a retryable draft without a phantom message', async () => {
  const { api, element } = harness({ fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'Sign in first' }) }) });
  const state = api.getState(), current = session();
  state.sessions = [current]; state.activeSessionId = current.id; state.view = 'chat';
  api.setRuntime({ local: true, authenticated: true });
  element('#chat-prompt').value = 'Explain this carefully';
  await api.sendChat();
  assert.equal(current.messages.length, 0);
  assert.equal(current.draft, 'Explain this carefully');
  assert.match(element('#chat-error').innerHTML, /Sign in first/);
});

test('imported history keeps recent messages within native UTF-8 limits', () => {
  const { api } = harness();
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Message ${i}` }));
  const selected = api.boundedHistory(history);
  assert.equal(selected.length, 24);
  assert.equal(selected[0].content, 'Message 6');
  assert.equal(selected.at(-1).content, 'Message 29');
  const large = api.boundedHistory([{ role: 'assistant', content: 'ह'.repeat(40_000) }]);
  assert.ok(new TextEncoder().encode(large[0].content).length <= 24000);
  assert.match(large[0].content, /earlier content truncated/);
  const bounded = api.boundedHistory(Array.from({ length: 10 }, () => ({ role: 'user', content: 'x'.repeat(24000) })));
  assert.ok(bounded.reduce((sum, m) => sum + new TextEncoder().encode(m.content).length, 0) <= 64000);
});

test('streamed Unicode replies survive arbitrary chunk boundaries and send prior history', async () => {
  let payload;
  const answer = 'नमस्ते\nA useful answer';
  const wire = new TextEncoder().encode(`${JSON.stringify({ type: 'text', text: answer })}\n${JSON.stringify({ type: 'done' })}\n`);
  const chunks = Array.from({ length: Math.ceil(wire.length / 7) }, (_, i) => wire.slice(i * 7, (i + 1) * 7));
  let at = 0;
  const { api, element } = harness({ fetchImpl: async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, body: { getReader: () => ({ read: async () => at < chunks.length ? { done: false, value: chunks[at++] } : { done: true } }) } };
  } });
  const state = api.getState(), current = session();
  current.messages.push({ role: 'user', content: 'We are studying physics.' }, { role: 'assistant', content: 'Let us begin.' });
  state.sessions = [current]; state.activeSessionId = current.id; state.view = 'chat';
  api.setRuntime({ local: true, authenticated: true });
  element('#chat-prompt').value = 'Continue our lesson';
  await api.sendChat();
  assert.equal(payload.history.length, 2);
  assert.equal(payload.history[0].content, 'We are studying physics.');
  assert.equal(current.messages.at(-1).content, answer);
  assert.equal(current.messages.length, 4);
});
