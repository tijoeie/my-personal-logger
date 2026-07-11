const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const DAY = 86400000;

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseISO(dateStr) - today) / DAY);
}
function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

// Runs every day at 8:00 AM UAE time (UTC+4 = 04:00 UTC)
exports.sendDueReminders = onSchedule({
  schedule: '0 4 * * *',
  timeZone: 'Asia/Dubai',
}, async (event) => {
    const db = admin.firestore();
    const messaging = admin.messaging();

    const [tokensSnap, usersSnap] = await Promise.all([
      db.collection('push_tokens').get(),
      db.collection('users').get(),
    ]);

    const userData = {};
    usersSnap.forEach(doc => { userData[doc.id] = doc.data(); });

    const sends = [];
    tokensSnap.forEach(tokenDoc => {
      const uid = tokenDoc.id;
      const { token } = tokenDoc.data();
      if (!token || !userData[uid] || !userData[uid].data) return;

      let S;
      try { S = JSON.parse(userData[uid].data); } catch (e) { return; }

      const dueItems = [];

      // Check CC payment due on the 25th
      const nowUAE = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
      const dayOfMonth = nowUAE.getDate();
      const accs = S.accounts || {};
      const enbdBal = Number((accs.enbd_cc || {}).balance || 0);
      const noonBal = Number((accs.noon_cc || {}).balance || 0);
      if (dayOfMonth === 25 || dayOfMonth === 24 || dayOfMonth === 23) {
        if (enbdBal > 0) dueItems.push(`💳 ENBD CC payment due: AED ${enbdBal.toFixed(2)}`);
        if (noonBal > 0) dueItems.push(`💳 NOON CC payment due: AED ${noonBal.toFixed(2)}`);
      }

      // Check renewals
      for (const r of S.renewals || []) {
        if (!r.expiry) continue;
        const days = daysUntil(r.expiry);
        const remind = r.remindDays || 60;
        if (days < 0) dueItems.push(`⚠️ ${r.title} EXPIRED`);
        else if (days <= 30) dueItems.push(`🔴 ${r.title}: ${days}d left`);
        else if (days <= remind) dueItems.push(`🟡 ${r.title}: ${days}d left`);
      }

      // Check car services
      for (const type of S.serviceTypes || []) {
        const logs = (S.serviceLog || []).filter(l => l.type === type.id).sort((a, b) => b.date.localeCompare(a.date));
        const last = logs[0];
        if (!last || !type.months) continue;
        const due = addMonths(parseISO(last.date), type.months);
        const days = Math.round((due - new Date()) / DAY);
        if (days < 0) dueItems.push(`⚠️ ${type.name} OVERDUE`);
        else if (days <= 30) dueItems.push(`🔴 ${type.name}: ${days}d`);
        else if (days <= 60) dueItems.push(`🟡 ${type.name}: ${days}d`);
      }

      if (!dueItems.length) return;

      const title = dueItems.length === 1
        ? 'My Personal Logger — ' + dueItems[0]
        : `My Personal Logger — ${dueItems.length} items need attention`;
      const body = dueItems.slice(0, 3).join('\n');

      sends.push(
        messaging.send({
          token,
          notification: { title, body },
          webpush: {
            notification: {
              icon: 'https://tijoeie.github.io/my-personal-logger/icons/icon-192.png',
              badge: 'https://tijoeie.github.io/my-personal-logger/icons/icon-192.png',
              tag: 'mpl-reminder',
              renotify: true,
            },
            fcmOptions: { link: 'https://tijoeie.github.io/my-personal-logger/' },
          },
        }).catch(e => console.log(`Push failed for ${uid}:`, e.message))
      );
    });

    await Promise.all(sends);
    console.log(`Sent ${sends.length} notifications`);
  });

// Generate a 6-digit sign-in code (called from Mac when signed in)
exports.generateCode = onRequest({
  cors: ['https://tijoeie.github.io'],
}, async (req, res) => {
  const idToken = req.body.idToken;
  if (!idToken) { res.status(400).json({ error: 'No token' }); return; }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const customToken = await admin.auth().createCustomToken(decoded.uid);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await admin.firestore().collection('signin_codes').doc(code).set({
      customToken,
      uid: decoded.uid,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    res.json({ code });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// Redeem a sign-in code (called from iPhone)
exports.redeemCode = onRequest({
  cors: ['https://tijoeie.github.io'],
}, async (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!code) { res.status(400).json({ error: 'No code' }); return; }
  try {
    const doc = await admin.firestore().collection('signin_codes').doc(code).get();
    if (!doc.exists) { res.status(404).json({ error: 'Invalid code' }); return; }
    const { customToken, expiresAt } = doc.data();
    if (Date.now() > expiresAt) { res.status(410).json({ error: 'Code expired' }); return; }
    await doc.ref.delete();
    res.json({ customToken });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
