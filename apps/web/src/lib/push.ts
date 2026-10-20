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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Subscribe and register with the server, then ask the server whether it
 * really has this device. A subscription made with an old key, or one the
 * server lost, is replaced. Tries a few times with a growing pause.
 */
async function subscribeAndConfirm(tenant: string, follows: PushFollow[], attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array((await publicApi.pushKey()).publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
        await sub.unsubscribe().catch(() => undefined);
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await publicApi.pushSubscribe(tenant, sub.toJSON(), follows);
      if ((await publicApi.pushCheck(sub.endpoint)).registered) return true;
      // The server didn't keep it: start over with a fresh subscription.
      await sub.unsubscribe().catch(() => undefined);
    } catch {
      /* network or push service hiccup — try again */
    }
    if (i < attempts - 1) await sleep(1000 * 2 ** i);
  }
  return false;
}

/** Ask permission (must run from a tap), subscribe, register and confirm; 'off' means it didn't take. */
export async function enablePush(tenant: string, follows: PushFollow[]): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  return (await subscribeAndConfirm(tenant, follows)) ? 'on' : 'off';
}

/**
 * On every open: permission already given, so make sure the server can still
 * reach this device (re-subscribing quietly if not) and knows its accounts.
 */
export async function ensurePush(tenant: string, follows: PushFollow[]): Promise<PushState> {
  const state = await pushState();
  if (state === 'unsupported' || state === 'ios-needs-install' || state === 'denied') return state;
  if (Notification.permission !== 'granted') return state;
  return (await subscribeAndConfirm(tenant, follows, 4)) ? 'on' : 'off';
}

/** One notification to this device only, to prove they arrive. */
export async function testPush() {
  const endpoint = await currentEndpoint();
  if (!endpoint) return false;
  const r = await publicApi.pushTest(endpoint).catch(() => null);
  return Boolean(r?.sent);
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
