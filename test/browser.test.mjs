import test from 'node:test';
import assert from 'node:assert/strict';
import { openLoginBrowser, loginLink } from '../src/browser.ts';

const url = 'https://chat.z.ai/api/oauth/authorize?client_id=example&redirect_uri=https%3A%2F%2Fzcode.z.ai%2Fapp&state=test';

test('Windows opens the complete OAuth URL without shell URL interpolation', async () => {
  let launch;
  const opened = await openLoginBrowser(url, { platform: 'win32', launch: async (file, args) => { launch = { file, args }; } });
  assert.equal(opened, true);
  assert.equal(launch.file, 'powershell.exe');
  const command = launch.args.at(-1);
  assert.ok(!command.includes(url));
  const encoded = command.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), url);
  assert.match(command, /Start-Process/);
});

test('browser launch failure leaves manual login possible and supported OS launchers use a single URL argument', async () => {
  for (const [platform, expected] of [['darwin', 'open'], ['linux', 'xdg-open']]) {
    await openLoginBrowser(url, { platform, launch: async (file, args) => {
      assert.equal(file, expected); assert.deepEqual(args, [url]);
    } });
  }
  assert.equal(await openLoginBrowser(url, { launch: async () => { throw new Error('No browser'); } }), false);
});

test('terminal hyperlinks are optional and reject unsafe URLs', async () => {
  assert.equal(loginLink(url, false), url);
  assert.ok(loginLink(url, true).includes('\x1b]8;;' + url));
  for (const invalid of ['file:///tmp/private', 'javascript:alert(1)', 'https://example.com/\x1b]8;;malicious']) {
    assert.throws(() => loginLink(invalid, true));
    let called = false;
    assert.equal(await openLoginBrowser(invalid, { launch: async () => { called = true; } }), false);
    assert.equal(called, false);
  }
});
