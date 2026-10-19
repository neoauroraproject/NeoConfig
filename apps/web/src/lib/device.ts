'use client';

/** A random ID for this browser install, for anonymous usage counts (no personal data). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('nc.device');
    if (!id) {
      const bytes = crypto.getRandomValues(new Uint8Array(15));
      id = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
      localStorage.setItem('nc.device', id);
    }
    return id;
  } catch {
    return 'nostorage00';
  }
}
