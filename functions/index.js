const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
admin.initializeApp({
  serviceAccountId: '753120537298-compute@developer.gserviceaccount.com',
});

const N8N_SECRET = defineSecret('N8N_INGEST_SECRET');

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

      // Check renewals (only items with notify enabled)
      for (const r of S.renewals || []) {
        if (!r.expiry || r.notify === false) continue;
        const days = daysUntil(r.expiry);
        const remind = r.remindDays || 60;
        if (days < 0) dueItems.push(`⚠️ ${r.title} EXPIRED`);
        else if (days <= 30) dueItems.push(`🔴 ${r.title}: ${days}d left`);
        else if (days <= remind) dueItems.push(`🟡 ${r.title}: ${days}d left`);
      }

      // Check car services (only items with notify enabled)
      for (const type of S.serviceTypes || []) {
        if (type.notify === false) continue;
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

function setCORS(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

// Generate a 6-digit sign-in code (called from Mac when signed in)
exports.generateCode = onRequest(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
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
exports.redeemCode = onRequest(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
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

// Ingest a bank transaction pushed by the n8n automation (Gmail -> parse -> here).
// Auto-logs to Expenses/Income and re-anchors the Mashreq balance if a running
// balance was included, so drift never accumulates.
exports.ingestTransaction = onRequest({ secrets: [N8N_SECRET] }, async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  try {
    const { uid, secret, amount, date, description, type, balance } = req.body || {};
    if (secret !== N8N_SECRET.value()) { res.status(401).json({ error: 'Invalid secret' }); return; }
    if (!uid || amount == null || !date || !type) {
      res.status(400).json({ error: 'Missing required fields: uid, amount, date, type' });
      return;
    }
    if (type !== 'debit' && type !== 'credit') {
      res.status(400).json({ error: "type must be 'debit' or 'credit'" });
      return;
    }

    const ref = admin.firestore().collection('users').doc(uid);
    const snap = await ref.get();
    let S = { expenses: [], incomes: [], accounts: {} };
    if (snap.exists && snap.data().data) {
      try { S = JSON.parse(snap.data().data); } catch (e) { /* keep default shell */ }
    }
    S.expenses = S.expenses || [];
    S.incomes = S.incomes || [];
    S.accounts = S.accounts || {};

    const entry = {
      id: Math.random().toString(36).slice(2, 10),
      date: String(date).slice(0, 10),
      amount: Number(amount),
      note: description || '',
      payMethod: 'bank',
      source: 'n8n',
      createdAt: Date.now(),
    };
    if (type === 'debit') {
      entry.cat = 'Other';
      S.expenses.push(entry);
    } else {
      S.incomes.push(entry);
    }

    if (balance != null && balance !== '' && balance !== 'null' && !Number.isNaN(Number(balance))) {
      S.accounts.mashreq = { name: 'Mashreq', type: 'bank', balance: Number(balance), balanceDate: entry.date, balanceAt: entry.createdAt };
    }

    await ref.set({ data: JSON.stringify(S), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true, id: entry.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
