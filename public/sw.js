/* Service worker — the only part of this app that runs when nobody has it open.

   Deliberately tiny. A service worker is the hardest thing in a web app to
   change once deployed: browsers cache it, it updates on its own schedule, and
   a bug in one can serve a stale application to somebody for days. So this one
   does exactly two things — show a notification, and open a page when it is
   clicked — and specifically does NOT cache anything. Offline support is a
   feature somebody should choose deliberately, not something that arrives as a
   side effect of wanting push. */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. A push
  // subscription is useless until the worker controlling it is active.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* A payload we cannot parse is still worth showing — a notification saying
       something happened beats silence, and the tag keeps it from stacking. */
  }

  const title = data.title || "Konecta One";
  const options = {
    body: data.body || "",
    // Same tag replaces rather than stacks, so a person who missed three
    // pushes about one request sees one notification, not three.
    tag: data.tag || "konecta-one",
    renotify: false,
    data: { url: data.url || "/" },
    icon: "/icon.svg",
    badge: "/icon.svg",
    // Low-urgency notifications should not vibrate a phone in a meeting.
    silent: data.urgency === "low",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  /* Focus an existing tab rather than opening a fourth copy of the app. People
     click notifications while the app is already open more often than not, and
     a new tab loses whatever they had half-typed in the old one. */
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
