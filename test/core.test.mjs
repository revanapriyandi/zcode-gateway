import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, Pool } from '../src/accounts.ts';
import { normalize, toChat, toResponses } from '../src/protocols.ts';

test('vault encrypts credentials, deduplicates identities and rejects tampering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-test-'));
  try {
    const file = join(dir, 'accounts.enc');
    const v = new Vault(file, 'a'.repeat(64));
    v.upsert({ identity: 'one', token: 'private-upstream-token', models: ['glm-5.3'] });
    v.upsert({ identity: 'one', token: 'replacement-token', models: ['glm-5.3'] });
    assert.equal(v.accounts.length, 1);
    assert.ok(!readFileSync(file, 'utf8').includes('replacement-token'));
    assert.equal(new Vault(file, 'a'.repeat(64)).accounts[0].token, 'replacement-token');
    const record = JSON.parse(readFileSync(file, 'utf8')); record.tag = Buffer.alloc(16).toString('base64');
    writeFileSync(file, JSON.stringify(record));
    assert.throws(() => new Vault(file, 'a'.repeat(64)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pool rotates eligible accounts, observes inflight and cooldown', () => {
  let now = 1000;
  const a = { id: 'a', enabled: true, models: ['glm-5.3'] };
  const b = { id: 'b', enabled: true, models: ['glm-5.3'] };
  const p = new Pool([a,b], () => now);
  const x = p.acquire('glm-5.3'); assert.equal(x.account.id, 'a');
  const y = p.acquire('glm-5.3'); assert.equal(y.account.id, 'b');
  assert.throws(() => p.acquire('glm-5.3'));
  x.release(); y.release(); p.cooldown('a', 3000);
  const z = p.acquire('glm-5.3'); assert.equal(z.account.id, 'b'); z.release();
  now = 5000; assert.ok(p.acquire('glm-5.3'));
  assert.throws(() => p.acquire('not-entitled'));
});

test('chat tool calls and tool results preserve identity and parsed arguments', () => {
  const n = normalize('chat', { model: 'glm-5.3', messages: [
    { role: 'system', content: 'system rules' },
    { role: 'user', content: 'weather' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Jakarta"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
  ], tools: [{ type: 'function', function: { name: 'weather', parameters: { type: 'object' } } }] });
  assert.equal(n.system, 'system rules');
  assert.deepEqual(n.messages[1].content[0].input, { city: 'Jakarta' });
  assert.equal(n.messages[2].content[0].tool_use_id, 'call_1');
  const output = { id: 'msg_1', model: 'glm-5.3', content: [{ type: 'tool_use', id: 'call_2', name: 'weather', input: { city: 'Bali' } }], stop_reason: 'tool_use', usage: { input_tokens: 4, output_tokens: 3 } };
  assert.equal(toChat(output).choices[0].finish_reason, 'tool_calls');
  assert.equal(toResponses(output).output[0].call_id, 'call_2');
});

test('Responses function outputs and hosted-tool rejection are explicit', () => {
  const n = normalize('responses', { model: 'glm-5.3', input: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }, { type: 'function_call_output', call_id: 'c1', output: '42' }] });
  assert.equal(n.messages[1].content[0].tool_use_id, 'c1');
  assert.throws(() => normalize('responses', { model: 'glm-5.3', input: 'hi', tools: [{ type: 'web_search_preview' }] }), /Unsupported/);
});
