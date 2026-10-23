import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Vault } from '../src/accounts.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('init refuses to generate unrelated keys over an existing vault', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-init-'));
  try {
    const data = join(dir, 'data'), file = join(data, 'accounts.enc');
    new Vault(file, 'a'.repeat(64)).upsert({ identity: 'one', token: 'private-token', models: ['glm-5.3'] });
    const before = readFileSync(file);
    const env = { ...process.env, ZCODE_DATA_DIR: data };
    const result = spawnSync(process.execPath, [cli, 'init'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing account vault/i);
    assert.equal(existsSync(join(dir, '.env')), false);
    assert.deepEqual(readFileSync(file), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
