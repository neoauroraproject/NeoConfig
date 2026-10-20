/**
 * Some customers paste one of their configs (`vless://…`) instead of the
 * subscription link. The credential inside it (uuid / password) identifies the
 * client on the panel, which lets us find the subscription link it belongs to.
 */
export interface ConfigCredential {
  protocol: string;
  /** uuid (vless, vmess, tuic) or password (trojan, shadowsocks, hysteria). */
  key: string;
  host: string | null;
}

const SCHEMES = ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2', 'hysteria', 'tuic'];
const CONFIG_RE = new RegExp(`^(${SCHEMES.join('|')})://\\S+`, 'i');

export function looksLikeConfig(text: string): boolean {
  return text.split(/\r?\n/).some((line) => CONFIG_RE.test(line.trim()));
}

/** First config line in the text that carries a usable credential. */
export function parseConfigLink(text: string): ConfigCredential | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = CONFIG_RE.exec(line);
    if (!m) continue;
    const protocol = m[1].toLowerCase();
    const found = protocol === 'vmess' ? parseVmess(line) : protocol === 'ss' ? parseShadowsocks(line) : parseUserInfo(line);
    if (found && found.key.length >= 4) return { protocol, ...found };
  }
  return null;
}

/** `vless://uuid@host:port?…#name`, `trojan://pass@…`, `tuic://uuid:pass@…`, `hy2://auth@…` */
function parseUserInfo(line: string): Omit<ConfigCredential, 'protocol'> | null {
  const body = line.slice(line.indexOf('://') + 3).split('#')[0];
  const at = body.lastIndexOf('@');
  if (at <= 0) return null;
  const user = safeDecode(body.slice(0, at));
  const key = (line.toLowerCase().startsWith('tuic://') ? user.split(':')[0] : user).trim();
  return key ? { key, host: hostOf(body.slice(at + 1)) } : null;
}

/** `vmess://` + base64 JSON ({ id, add, … }), or the rarer `vmess://uuid@host:port` form. */
function parseVmess(line: string): Omit<ConfigCredential, 'protocol'> | null {
  const body = line.slice('vmess://'.length).split('#')[0];
  const json = b64(body.split('?')[0]);
  if (json) {
    try {
      const o = JSON.parse(json) as { id?: unknown; add?: unknown };
      if (typeof o.id === 'string' && o.id.trim()) {
        return { key: o.id.trim(), host: typeof o.add === 'string' ? o.add : null };
      }
    } catch {
      /* not JSON — try the URI form */
    }
  }
  return parseUserInfo(line);
}

/**
 * `ss://b64(method:password)@host:port`, `ss://b64(method:password@host:port)` or
 * `ss://method:password@…`. Multi-user 2022 links carry `method:server:client`;
 * the last part is the client's own password.
 */
function parseShadowsocks(line: string): Omit<ConfigCredential, 'protocol'> | null {
  let body = line.slice('ss://'.length).split('#')[0].split('?')[0];
  if (!body.includes('@')) body = b64(body) ?? body;
  const at = body.lastIndexOf('@');
  if (at <= 0) return null;
  let user = safeDecode(body.slice(0, at));
  if (!user.includes(':')) user = b64(user) ?? user;
  const parts = user.split(':');
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1].trim();
  return key ? { key, host: hostOf(body.slice(at + 1)) } : null;
}

function hostOf(rest: string): string | null {
  const hostPort = rest.split(/[/?]/)[0];
  if (hostPort.startsWith('[')) return hostPort.slice(1, hostPort.indexOf(']')) || null;
  return hostPort.split(':')[0] || null;
}

function b64(s: string): string | null {
  const clean = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!clean || !/^[A-Za-z0-9+/]+=*$/.test(clean)) return null;
  try {
    const text = Buffer.from(clean, 'base64').toString('utf8');
    return /^[\x20-\x7e\s]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
