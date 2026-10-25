// Salary periods as pure functions of (salaryDay, incomes): the app and the server's weekly summary share them.
// A period starts the day the salary credit actually landed (a "Salary" income within a week before to four
// days after the nominal salary day), else on the nominal day; it ends the day before the next one starts.
const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const nominalStart = (day, y, m) => new Date(y, m, day || 25);
export function salaryCredit(day, incomes, y, m) {
  const nom = nominalStart(day, y, m);
  const from = new Date(nom.getFullYear(), nom.getMonth(), Math.max(1, nom.getDate() - 7));
  const to = new Date(nom.getFullYear(), nom.getMonth(), nom.getDate() + 4);
  const hits = (incomes || []).filter(i => /salary/i.test(i.note || '') && !/reconcil/i.test(i.note || '') && Number(i.amount) > 0 && i.date)
    .map(i => parseISO(i.date)).filter(d => d >= from && d <= to).sort((a, b) => a - b);
  return hits[0] || null;
}
export const monthStart = (day, incomes, y, m) => salaryCredit(day, incomes, y, m) || nominalStart(day, y, m);
export function periodOf(day, incomes, d) {
  const y = d.getFullYear(), m = d.getMonth();
  const [py, pm] = d >= monthStart(day, incomes, y, m) ? [y, m] : [y, m - 1];
  return { start: monthStart(day, incomes, py, pm), end: new Date(monthStart(day, incomes, py, pm + 1) - DAY) };
}
export function nextSalaryDate(day, incomes, t) {
  const y = t.getFullYear(), m = t.getMonth();
  const got = salaryCredit(day, incomes, y, m);
  if (got) return t < got ? got : nominalStart(day, y, m + 1);
  return t <= nominalStart(day, y, m) ? nominalStart(day, y, m) : nominalStart(day, y, m + 1);
}
