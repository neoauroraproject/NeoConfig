'use client';

import { PushFollow, publicApi } from './api';

export type PushState = 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function isIos() {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function currentEndpoint(): Promise<string | undefined> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  return sub?.endpoint;
}

/** What the server needs to follow each saved account. */
export function followsOf(accounts: Array<{ id: string; url: string }>): PushFollow[] {
  return accounts.map((a) => ({ subId: a.id, url: a.url }));
}

/** Ask permission (must run from a tap), subscribe and tell the server which subscriptions to follow. */
export async function enablePush(tenant: string, follows: PushFollow[]): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await publicApi.pushKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await publicApi.pushSubscribe(tenant, sub.toJSON(), follows);
  return 'on';
}

/** Keep the server's list of followed subscriptions in sync after adds/removes. */
export async function syncPush(tenant: string, follows: PushFollow[]) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (sub) await publicApi.pushSubscribe(tenant, sub.toJSON(), follows).catch(() => undefined);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await publicApi.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
