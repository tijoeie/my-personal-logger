// Live AED -> INR rate from a free public feed, cached for 30 minutes (one lookup serves the app and the alerts).
let cache = null;
export async function getRate(fetchImpl = fetch, now = Date.now()) {
  if (cache && now - cache.at < 30 * 60000) return cache;
  const r = await fetchImpl('https://open.er-api.com/v6/latest/AED', { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  const rate = Number(j && j.rates && j.rates.INR);
  if (!(rate > 0)) throw new Error('no INR rate in the feed');
  cache = { rate, at: now };
  return cache;
}
export const resetRateCache = () => { cache = null; };
