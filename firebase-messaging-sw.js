/* Firebase Cloud Messaging service worker — handles push when app is closed */
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyA79ft06v7FzKIdKSBQU5rQEGZbJX9Tom4',
  authDomain: 'personal-life-assistant-logger.firebaseapp.com',
  projectId: 'personal-life-assistant-logger',
  storageBucket: 'personal-life-assistant-logger.firebasestorage.app',
  messagingSenderId: '753120537298',
  appId: '1:753120537298:web:efcdedc823bc23cace9b0b',
});

const messaging = firebase.messaging();

// Show notification when app is in background / closed
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;
  self.registration.showNotification(title, {
    body: body || '',
    icon: '/my-personal-logger/icons/icon-192.png',
    badge: '/my-personal-logger/icons/icon-192.png',
    tag: 'mpl-reminder',
    renotify: true,
  });
});
