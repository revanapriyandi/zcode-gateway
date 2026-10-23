import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export class Vault {
  accounts: any[] = [];
  file: string;
  key: Buffer;
  constructor(file: string, secret: string) {
    if (!secret || secret.length < 32) throw new Error('Master key must contain at least 32 characters');
    this.file = file;
    this.key = createHash('sha256').update(secret).digest();
    if (existsSync(file)) {
      const r = JSON.parse(readFileSync(file, 'utf8'));
      if (r.version !== 1) throw new Error('Unsupported vault version');
      const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(r.iv, 'base64'));
      d.setAAD(Buffer.from('zcode-gateway:v1'));
      d.setAuthTag(Buffer.from(r.tag, 'base64'));
      this.accounts = JSON.parse(Buffer.concat([d.update(Buffer.from(r.data, 'base64')), d.final()]).toString());
      if (!Array.isArray(this.accounts)) throw new Error('Invalid account vault');
    }
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from('zcode-gateway:v1'));
    const data = Buffer.concat([c.update(JSON.stringify(this.accounts)), c.final()]);
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, this.file);
  }
  upsert(record: any) {
    if (!record.identity || !record.token || !Array.isArray(record.models)) throw new Error('Incomplete account');
    const existing = this.accounts.find(a => a.identity === record.identity);
    const account = { ...existing, id: existing?.id || randomUUID(), enabled: true, ...record, updatedAt: Date.now() };
    if (existing) this.accounts[this.accounts.indexOf(existing)] = account;
    else this.accounts.push(account);
    this.save(); return account;
  }
  publicAccounts() {
    return this.accounts.map(({ id, label, models, enabled, quota, updatedAt, needsLogin, plan, selectedPlanId, plans }) => ({ id, label, models, enabled, quota, updatedAt, needsLogin, plan:plan || 'start-plan', selectedPlanId, plans }));
  }
}

export class Pool {
  accounts: any[];
  now: () => number;
  cursor = 0;
  states = new Map<string, { active: number; until: number }>();
  constructor(accounts: any[], now = Date.now) { this.accounts = accounts; this.now = now; }
  state(id: string) {
    if (!this.states.has(id)) this.states.set(id, { active: 0, until: 0 });
    return this.states.get(id)!;
  }
  cooldown(id: string, ms: number) { this.state(id).until = this.now() + Math.max(0, ms); }
  acquire(model: string, excluded = new Set<string>()) {
    for (let n = 0; n < this.accounts.length; n++) {
      const i = (this.cursor + n) % this.accounts.length, a = this.accounts[i], s = this.state(a.id);
      if (!a.enabled || a.needsLogin || !a.models.includes(model) || excluded.has(a.id) || s.active >= 1 || s.until > this.now()) continue;
      s.active++; this.cursor = (i + 1) % this.accounts.length;
      let released = false;
      return { account: a, release: () => { if (!released) { released = true; s.active--; } } };
    }
    throw Object.assign(new Error('No enabled account is currently available for this model'), { status: 503 });
  }
}
