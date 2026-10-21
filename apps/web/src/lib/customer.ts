'use client';

/** A signed-in customer login on this device, kept per storefront like the accounts. */
export type Session = { token: string; username: string };

const key = (tenant: string) => `nc.session.v1.${tenant}`;

export function loadSession(tenant: string): Session | null {
  try {
    const raw = localStorage.getItem(key(tenant));
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s?.token && s.username ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(tenant: string, s: Session) {
  try {
    localStorage.setItem(key(tenant), JSON.stringify(s));
  } catch {
    /* storage blocked: signed in for this visit only */
  }
}

export function clearSession(tenant: string) {
  try {
    localStorage.removeItem(key(tenant));
  } catch {
    /* ignore */
  }
}
