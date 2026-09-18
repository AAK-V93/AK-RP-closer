self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "Tienes un pendiente" };
  }
  const title = data.title || "Closer Trainer";
  const body = data.body || "Tienes un pendiente";
  const alertId = data.alertId || "";
  const token = data.token || "";
  const url = data.url || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || alertId || "hub",
      data: { url, alertId, token },
      actions: alertId
        ? [
            { action: "hecho", title: "Hecho" },
            { action: "no_contesto", title: "No contestó" },
            { action: "abrir", title: "Abrir" },
          ]
        : [{ action: "abrir", title: "Abrir" }],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action || "abrir";
  if ((action === "hecho" || action === "no_contesto") && data.token) {
    event.waitUntil(
      fetch("/api/push/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: data.token, resultado: action }),
      }),
    );
    return;
  }
  const url = data.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
