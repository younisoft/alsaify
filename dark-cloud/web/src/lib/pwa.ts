import { useEffect, useState } from 'react';

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
let waiting: ServiceWorker | null = null;
let installEvent: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { waiting = w; emit(); } });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; emit(); }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // check for a new version every 30 minutes and whenever the app returns to the foreground
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch { /* the app works without a service worker */ }
  });
  // Reload only when an existing version is replaced at the user's request — never on first install,
  // which would wipe whatever the user is typing.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as typeof installEvent; emit(); });
  addEventListener('appinstalled', () => { installEvent = null; emit(); });
}

export function applyUpdate() { waiting?.postMessage('SKIP_WAITING'); }
export async function promptInstall() { if (!installEvent) return; await installEvent.prompt(); await installEvent.userChoice; installEvent = null; emit(); }
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function usePwa() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return { updateReady: !!waiting, canInstall: !!installEvent && !isStandalone(), standalone: isStandalone() };
}
