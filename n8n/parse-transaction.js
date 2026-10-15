// Works with the IMAP trigger (textPlain / textHtml) and with the Gmail trigger (text / snippet).
// Some Mashreq alerts are HTML-only, so strip tags when there is no plain text.
function htmlToText(h) {
  return String(h || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
}
const item = $input.item.json;
// Flatten line breaks / non-breaking spaces so wrapped emails still match
const raw = (item.textPlain || item.text || item.snippet || htmlToText(item.textHtml)).replace(/\s+/g, ' ').trim();

// "Now" in Dubai, or the email's own sent time when the trigger provides one (keeps backfilled alerts on the right day)
function uaeNow() {
  const sent = item.date ? new Date(item.date) : null;
  const base = sent && !isNaN(sent) ? sent : new Date();
  return new Date(base.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
}
function isoDateFrom(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function displayDateFrom(d) {
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${d.getFullYear()}`;
}
function displayTimeFrom(d) {
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ap}`;
}
// Picks up "Available balance is AED 1,234.56" style lines if the email has one
function findBalance(text) {
  const m = text.match(/(?:available|avl\.?|current|closing|updated)\s+(?:account\s+)?(?:balance|bal\.?|limit)\s*(?:is|of|:)?\s*(?:AED|Dhs?\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  return m ? m[1].replace(/,/g, '') : null;
}
function cleanNote(text) {
  return text.replace(/\.\s*(?:available|avl\.?|current|closing|updated)\s+(?:account\s+)?(?:balance|bal\.?|limit)[\s\S]*$/i, '').trim();
}
function accountFallback(acNo, note) {
  const now = uaeNow();
  const bal = findBalance(raw);
  return {
    cardType: 'Mashreq Account',
    cardLast4: acNo.slice(-4),
    merchant: note,
    date: displayDateFrom(now),
    time: displayTimeFrom(now),
    isoDate: isoDateFrom(now),
    availableLimit: bal || 'N/A',
    balance: bal,
    acNo,
  };
}

// 1) Card purchase alert (has date, time and available balance in the text)
const cardRegex = /Your (.+?) Card ending with (\d+) was used for a purchase of AED\s*([\d,]+\.\d{2}) at (.+?) on (\d{2}-[A-Z]{3}-\d{4}) (\d{2}:\d{2} [AP]M)\.\s*Available limit is AED\s*([\d,]+\.\d{2})/;
const cardMatch = raw.match(cardRegex);
if (cardMatch) {
  const [, cardType, cardLast4, amount, merchant, date, time, availableLimit] = cardMatch;
  const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const [, dd, mon, yyyy] = date.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
  return {
    json: {
      parsed: true,
      type: 'debit',
      cardType: cardType.trim(),
      cardLast4,
      amount: amount.replace(/,/g, ''),
      merchant: merchant.trim(),
      note: merchant.trim(),
      date,
      time,
      isoDate: `${yyyy}-${MONTHS[mon]}-${dd}`,
      availableLimit: availableLimit.replace(/,/g, ''),
      balance: availableLimit.replace(/,/g, ''),
      rawText: raw
    }
  };
}

// 2) Account debit — fees, ATM charges, transfers out, etc.
const acDebitRegex = /Your AC No:?\s*([X\d]+)\s*is debited with AED\s*([\d,]+\.\d{2})\s*(?:as|for)\s+(.+?)\.\s*Login to Online Banking/;
const acDebitMatch = raw.match(acDebitRegex);
if (acDebitMatch) {
  const [, acNo, amount, reason] = acDebitMatch;
  const note = cleanNote(reason);
  return {
    json: {
      parsed: true,
      type: 'debit',
      amount: amount.replace(/,/g, ''),
      note,
      rawText: raw,
      ...accountFallback(acNo, note)
    }
  };
}

// 3) Account credit — salary, incoming transfers, etc.
const acCreditRegex = /Your AC No:?\s*([X\d]+)\s*is credited with AED\s*([\d,]+\.\d{2})\s*for (.+?)\.\s*Login to Online Banking/;
const acCreditMatch = raw.match(acCreditRegex);
if (acCreditMatch) {
  const [, acNo, amount, reason] = acCreditMatch;
  const note = cleanNote(reason);
  return {
    json: {
      parsed: true,
      type: 'credit',
      amount: amount.replace(/,/g, ''),
      note,
      rawText: raw,
      ...accountFallback(acNo, note)
    }
  };
}

// 4) Nothing matched
return {
  json: {
    parsed: false,
    rawText: raw
  }
};
