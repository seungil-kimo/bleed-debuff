// 앱이 닫혀 있을 때 알림을 받아서 보여주는 파일
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDVm5EsM1kKLO3vhkTe9OVyRR2e5YtBVXw",
  authDomain: "bleed-debuff.firebaseapp.com",
  projectId: "bleed-debuff",
  storageBucket: "bleed-debuff.firebasestorage.app",
  messagingSenderId: "1013696072055",
  appId: "1:1013696072055:web:bd56b24c4779bba96c7972"
});
firebase.messaging();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// 알림을 누르면 앱을 열어요
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(self.registration.scope);
  })());
});
