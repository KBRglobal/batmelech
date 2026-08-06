import { HebrewCalendar, Location } from '@hebcal/core';
import fs from 'fs';
const loc = new Location(25.2048, 55.2708, false, 'Asia/Dubai', 'Dubai', 'AE');
const start = new Date();
const end = new Date(); end.setDate(end.getDate() + 130 * 7);
const events = HebrewCalendar.calendar({ start, end, location: loc, candlelighting: true, sedrot: true, il: false });
const strip = s => s.replace(/־/g, ' ').replace(/[֑-ֽֿ-ׇ]/g, '');
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false });
const table = {};
for (const ev of events) {
  const d = ev.getDate().greg();
  if (ev.getDesc() === 'Candle lighting' && d.getDay() === 5) {
    (table[iso(d)] = table[iso(d)] || {}).c = fmt.format(ev.eventTime);
  }
}
for (const ev of events) {
  const d = ev.getDate().greg();
  if (d.getDay() !== 6) continue;
  const fri = new Date(d); fri.setDate(fri.getDate() - 1);
  const key = iso(fri);
  if (!table[key]) continue;
  const desc = ev.getDesc();
  const he = strip(ev.render('he'));
  if (desc.startsWith('Parashat')) table[key].p = he;
  else if (!table[key].p && !desc.includes('Candle') && !desc.includes('Havdalah')) table[key].h = he;
}
const out = Object.fromEntries(Object.entries(table).filter(([, v]) => v.c));
fs.writeFileSync('shabbat-table.json', JSON.stringify(out));
console.log('entries:', Object.keys(out).length, 'bytes:', JSON.stringify(out).length);
console.log('sample:', JSON.stringify(Object.entries(out).slice(0, 5)));
console.log('rosh-hashana-area:', JSON.stringify(Object.entries(out).filter(([k]) => k >= '2026-09-10' && k <= '2026-10-05')));
