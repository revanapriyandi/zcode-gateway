import { randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'https://zcode.z.ai';
export async function beginLogin(provider = 'zai', fetcher: any = fetch, version = '3.16.3') {
  if (!['zai', 'bigmodel'].includes(provider)) throw new Error('Unknown OAuth provider');
  const pollToken = randomBytes(32).toString('hex');
  const response = await fetcher(origin + '/api/v1/oauth/cli/init', { method: 'POST', headers: { Authorization: 'Bearer '+pollToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }), redirect: 'error', signal: AbortSignal.timeout(30000) });
  const envelope = await response.json();
  if (!response.ok || envelope.code !== 0) throw new Error('OAuth initialization failed: '+response.status);
  const d = envelope.data;
  const url = new URL(d?.authorize_url);
  const allowed = provider === 'zai' ? ['https://chat.z.ai', origin] : ['https://bigmodel.cn', 'https://www.bigmodel.cn', origin];
  if (!allowed.includes(url.origin) || url.username || url.password) throw new Error('Unexpected OAuth authorization origin');
  if (!d.flow_id || !Number.isFinite(d.expires_at) || !Number.isFinite(d.poll_interval_sec)) throw new Error('Invalid OAuth flow');
  const redirect = new URL('/app/oauth/login', origin);
  redirect.searchParams.set('redirect', 'zcode://oauth/callback'); redirect.searchParams.set('app_version', version);
  url.searchParams.set(provider === 'zai' ? 'redirect_uri' : 'redirect', redirect.href);
  return { provider, flowId: d.flow_id, pollToken, authorizeUrl: url.href, expiresAt: Math.min(d.expires_at*1000, Date.now()+300000), interval: Math.max(1000, d.poll_interval_sec*1000) };
}
export async function finishLogin(flow: any, options: any = {}) {
  const fetcher = options.fetcher || fetch, sleep = options.sleep || pause;
  while (Date.now() < flow.expiresAt) {
    options.signal?.throwIfAborted();
    let response;
    try {
      response = await fetcher(origin + '/api/v1/oauth/cli/poll/' + encodeURIComponent(flow.flowId), { headers: { Authorization: 'Bearer '+flow.pollToken }, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    } catch { options.signal?.throwIfAborted(); await sleep(flow.interval); continue; }
    if ([408,429].includes(response.status) || response.status >= 500) { await sleep(flow.interval); continue; }
    if (!response.ok) throw new Error('OAuth authorization rejected: '+response.status);
    let e; try { e = await response.json(); } catch { await sleep(flow.interval); continue; }
    if (e.code !== 0) throw new Error('OAuth authorization rejected');
    const d = e.data;
    if (d?.status === 'ready') {
      if (!d.token || !d.user?.user_id) throw new Error('OAuth response omitted account identity or plan token');
      return { identity: flow.provider+':'+d.user.user_id, provider: flow.provider, token: d.token, accessToken: d[flow.provider]?.access_token, models: [] };
    }
    if (d?.status !== 'pending') throw new Error('OAuth flow failed or was cancelled');
    await sleep(Math.min(flow.interval, Math.max(0,flow.expiresAt-Date.now())));
  }
  throw new Error('OAuth flow expired; start a new login');
}
