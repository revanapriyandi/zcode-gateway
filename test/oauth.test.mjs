import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLogin, finishLogin } from '../src/oauth.ts';

test('OAuth keeps polling secret server-side and handles pending then ready', async () => {
  let polls = 0; let auth;
  const fetcher = async (url, init) => {
    auth = init.headers.Authorization;
    if (url.endsWith('/init')) return Response.json({ code: 0, data: { flow_id: 'flow', authorize_url: 'https://chat.z.ai/api/oauth/authorize?client_id=test', expires_at: Math.floor(Date.now()/1000)+60, poll_interval_sec: 1 } });
    polls++;
    return Response.json({ code: 0, data: polls === 1 ? { status: 'pending' } : { status: 'ready', token: 'jwt-test', user: { user_id: 'user-test' }, zai: { access_token: 'oauth-test' } } });
  };
  const flow = await beginLogin('zai', fetcher);
  assert.ok(flow.authorizeUrl.startsWith('https://chat.z.ai/'));
  assert.ok(!flow.authorizeUrl.includes(flow.pollToken));
  const record = await finishLogin(flow, { fetcher, sleep: async () => {} });
  assert.equal(record.token, 'jwt-test'); assert.equal(record.identity, 'zai:user-test');
  assert.equal(polls, 2); assert.equal(auth, 'Bearer '+flow.pollToken);
});

test('OAuth rejects expired flows and unexpected authorization origins', async () => {
  await assert.rejects(beginLogin('zai', async () => Response.json({code:0,data:{authorize_url:'https://evil.example/login',flow_id:'x',expires_at:9999999999,poll_interval_sec:1}})), /origin/);
  await assert.rejects(finishLogin({expiresAt:0}, {}), /expired/);
});
