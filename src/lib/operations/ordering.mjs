function reject(code) { throw Object.assign(new Error(`OPS_${code}`), { code: `OPS_${code}` }); }

// Same proleptic Gregorian epoch as the pinned projection. Fraction digits are
// retained as text; never pass source ordering through JS Date or floats.
export function exactOrder(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})(?![\s\S])/u.exec(value);
  if (!match || match[8] === '-00:00' || (match[7]?.length ?? 0) > 256) reject('TIMESTAMP');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const months = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > months[month - 1] || hour > 23 || minute > 59 || second > 59) reject('TIMESTAMP');
  let offset = 0;
  if (!/^[Zz]$/u.test(match[8])) {
    const h = Number(match[8].slice(1, 3)); const m = Number(match[8].slice(4, 6));
    if (h > 23 || m > 59) reject('TIMESTAMP');
    offset = (h * 60 + m) * (match[8][0] === '+' ? 1 : -1);
  }
  const y = BigInt(year); const days = y * 365n + (y + 3n) / 4n - (y + 99n) / 100n + (y + 399n) / 400n
    + BigInt(months.slice(0, month - 1).reduce((a, b) => a + b, 0) + day - 1);
  return { order_seconds: (days * 86400n + BigInt(hour * 3600 + minute * 60 + second - offset * 60)).toString(),
    order_fraction: (match[7] ?? '').replace(/0+$/u, '') };
}
