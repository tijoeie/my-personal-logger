// Receipt photos: shrink on the phone, upload to the server, show on demand. The expense keeps only the id.
const TOKEN_KEY = 'mpl_token';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } } };
const auth = () => ({ Authorization: 'Bearer ' + (ls.get(TOKEN_KEY) || '') });

// Photo -> JPEG no larger than 1600px on its long side (about 150-300 KB), as base64 without the data: prefix
export function shrink(file, max = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}
export async function uploadReceipt(file) {
  const data = await shrink(file);
  const r = await fetch('/api/receipts', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Upload failed');
  return (await r.json()).id;
}
export async function receiptUrl(id) {
  const r = await fetch('/api/receipts/' + id, { headers: auth() });
  if (!r.ok) throw new Error('Receipt not found');
  return URL.createObjectURL(await r.blob());
}
export const deleteReceipt = id => fetch('/api/receipts/' + id, { method: 'DELETE', headers: auth() }).catch(() => {});
