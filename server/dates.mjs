// Every date the server writes for a person (Telegram, PDF) is DD/MM/YYYY.
const pad = n => String(n).padStart(2, '0');
export const dmyDate = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || ''); };
