/**
 * Web Push handlers, imported into the generated service worker.
 *
 * Why this file exists at all: `send-notification` has signed and delivered
 * Web Push messages since migration 0009, and the browser has been dropping
 * every one of them. A push with no `push` listener in the service worker does
 * nothing visible — no error, no log, nothing for the sender to notice. The
 * VAPID keypair was real, the subscription rows were real, the send reported
 * success, and no staff member ever saw a notification.
 *
 * Why a separate file rather than a custom service worker: the project uses
 * Workbox's `generateSW` strategy, which writes the whole service worker and
 * accepts no inline code. `workbox.importScripts` is the supported seam for
 * exactly this, and it keeps the precache/runtime-caching config generated
 * rather than hand-maintained. Switching to `injectManifest` would mean owning
 * the entire service worker to add twenty lines.
 *
 * This file is served verbatim from `public/`, so it is plain ES5-compatible
 * JavaScript with no build step and no imports.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  // The sender posts JSON (`send-notification` stringifies `{title, body}`),
  // but a malformed or plain-text payload must not throw inside the handler —
  // an exception here loses the notification as silently as having no handler
  // at all, which is the bug this file closes.
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'RotaFlow', body: event.data.text() };
  }

  const title = payload.title || 'RotaFlow';
  const options = {
    body: payload.body || '',
    icon: '/icons/pwa-192.png',
    badge: '/icons/pwa-192.png',
    // Same tag collapses repeats of one event rather than stacking them on a
    // phone someone checks once a shift.
    tag: payload.tag || 'rotaflow',
    data: { url: payload.url || '/app/notifications' },
  };

  // waitUntil keeps the service worker alive until the notification is shown.
  // Without it the worker can be killed mid-call and the notification is lost.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app/notifications';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an open tab rather than opening a second one. A staff member on
      // an old Android with the PWA already installed should not end up with
      // two instances because they tapped a notification.
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
