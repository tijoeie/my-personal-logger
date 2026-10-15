const fs = require('fs');
const code = fs.readFileSync(__dirname + '/parse-transaction.js', 'utf8');
const run = text => new Function('$input', code)({ item: { json: { text } } }).json;
const cases = {
  card: 'Your Neo VISA Debit Card Card ending with 2256 was used for a purchase of AED 49.99 at Disney Plus London GB on 20-SEP-2026 11:42 PM. Available limit is AED  544.84\n\nThis is a system generated alert.',
  atm: 'Your AC No: XXXXXXXX7776 is debited with AED 2.10 as ATM withdrawal charges (Incl. VAT as applicable). Login to Online Banking for details.\n\nTo view details',
  atmWithBal: 'Your AC No: XXXXXXXX7776 is debited with AED 2.10 as ATM withdrawal charges (Incl. VAT as applicable). Available balance is AED 1,234.56. Login to Online Banking for details.',
  ipp: 'Your AC No:XXXXXXXX7776 is credited with AED 600.00 for Aani Instant Payments (Local IPP Transfer). Login to Online Banking for details.',
  salary: 'Your AC No: XXXXXXXX7776 is credited with AED 6685.10 for Salary.\nLogin to Online Banking for details.',
  junk: 'Hello world',
};
for (const [k, t] of Object.entries(cases)) {
  const j = run(t);
  console.log(k.padEnd(10), JSON.stringify({ parsed: j.parsed, type: j.type, amount: j.amount, note: j.note, isoDate: j.isoDate, balance: j.balance }));
}
