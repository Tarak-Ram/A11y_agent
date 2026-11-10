import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  const m = ip.replace(/^::ffff:/, '').split('.').map(Number);
  if (m.length !== 4) return false;
  const [a, b] = m;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Only http(s) URLs; in production, refuse hosts that resolve to private/link-local addresses (SSRF guard). */
export async function assertScannableUrl(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new BadRequestException('Only http(s) URLs can be scanned');
  const allowPrivate = (process.env.ALLOW_PRIVATE_URLS ?? (process.env.NODE_ENV === 'production' ? '0' : '1')) === '1';
  if (!allowPrivate) {
    const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      throw new BadRequestException('URL must be publicly reachable');
    }
  }
  return u.toString();
}
