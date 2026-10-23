import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const loginOrigins = new Set(['https://chat.z.ai', 'https://zcode.z.ai', 'https://bigmodel.cn', 'https://www.bigmodel.cn']);

function validateLoginUrl(value: string) {
  if (/[\x00-\x20\x7f]/.test(value)) throw new Error('Invalid login URL');
  const url = new URL(value);
  if (!loginOrigins.has(url.origin) || url.username || url.password) throw new Error('Unexpected login origin');
}

export function loginLink(url: string, terminal = false) {
  validateLoginUrl(url);
  return terminal ? '\x1b]8;;'+url+'\x1b\\Open ZCode login\x1b]8;;\x1b\\' : url;
}

type BrowserOptions = { platform?: string; launch?: (file: string, args: string[]) => Promise<unknown> };
export async function openLoginBrowser(url: string, options: BrowserOptions = {}) {
  try {
    validateLoginUrl(url);
    const platform = options.platform || process.platform;
    const launch = options.launch || ((file, args) => execute(file, args, { windowsHide: true, timeout: 5000 }));
    if (platform === 'win32') {
      const encoded = Buffer.from(url, 'utf8').toString('base64');
      await launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encoded+"')))"]);
    } else {
      await launch(platform === 'darwin' ? 'open' : 'xdg-open', [url]);
    }
    return true;
  } catch {
    return false;
  }
}
