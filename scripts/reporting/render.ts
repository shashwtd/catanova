import type { Metric, Window } from './retention.js';
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const display = (n: number | null) => (n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
export function renderCsv(metrics: Metric[]): string {
  const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return (
    [
      ['section', 'metric', 'value', 'denominator', 'unit'],
      ...metrics.map((m) => [m.section, m.metric, m.value, m.denominator, m.unit]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\n') + '\n'
  );
}
export function renderHtml(metrics: Metric[], window: Window): string {
  const sections = [...new Set(metrics.map((m) => m.section))];
  const table = (section: string) =>
    `<section><h2>${escape(section.replace('humanOnly', 'Human only').replace('withBots', 'With bots').replace('all', 'All'))}</h2><table><thead><tr><th>Measure</th><th>Value</th><th>Count / sample</th></tr></thead><tbody>${metrics
      .filter((m) => m.section === section)
      .map(
        (m) =>
          `<tr><td>${escape(m.metric)}</td><td>${display(m.value)}${m.denominator !== undefined && m.denominator > 0 && !m.unit ? ` <small>(${((100 * (m.value ?? 0)) / m.denominator).toFixed(1)}%)</small>` : ''}</td><td>${m.denominator === undefined ? '—' : m.unit ? `n = ${m.denominator}` : `${display(m.value)} / ${m.denominator}`}</td></tr>`,
      )
      .join('')}</tbody></table></section>`;
  const primary = ['Matches · all', 'Duration · all', 'Group return', 'Account return · all'];
  const completed = metrics.find((m) => m.section === 'Checkpoint')?.value ?? 0;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Catanova · Private retention report</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f3eb;color:#292b29;font:16px/1.5 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:36px 24px}h1{font-size:30px;line-height:1.2}h2{font-size:19px}section{padding:16px 20px;background:white;border:1px solid #dfddd4;border-radius:10px;margin:16px 0}p{max-width:90ch}.muted,small{color:#5f675f}.note{padding:14px 18px;background:#e5ece5;border-left:4px solid #607960}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 4px;border-bottom:1px solid #ecebe5}th{color:#59615a;font-size:13px}td:nth-child(n+2){font-variant-numeric:tabular-nums;white-space:nowrap}a{color:#275a47}summary{cursor:pointer;font-weight:600;padding:12px 0}@media(max-width:600px){main{padding:18px 12px}section{padding:10px}td{font-size:13px}small{display:block}}
  </style><main><p class="muted">CATANOVA · PRIVATE REPORT</p><h1>Do games finish, and do people return?</h1><p>${new Date(window.from).toISOString()} → ${new Date(window.to).toISOString()} (start cohort; end excluded).<br>Observed through ${new Date(window.asOf).toISOString()}.</p><p><a href="retention.csv" download>Download aggregate CSV</a></p><p class="note">${completed < 20 ? 'Fewer than 20 completed human multiplayer matches: use these findings as directional, then proceed with expansion.' : 'Review these counts alongside player feedback; they do not prove that a UI change caused retention.'}</p>
  ${primary.map(table).join('')}
  <p>Elapsed duration includes pauses and time offline. Running matches are pending, not failures. Group return means at least two shared human accounts in the first qualifying next match; same-room and new-room counts are parts of the overall rate. No matchmaking or automatic rematch is implied.</p>
  <p>24–48-hour return is anchored to each account’s first observed match with a proven human action, across the entire snapshot. It is not a calendar-day metric. Incomplete observation windows are excluded. Earlier missing or unclassified activity can limit this first-observed anchor. A bot or timer action is never a human return.</p>
  <details><summary>Bot mix and account-type breakdowns</summary>${sections
    .filter((s) => !primary.includes(s) && s !== 'Coverage' && s !== 'Checkpoint')
    .map(table)
    .join('')}</details>
  ${table('Coverage')}
  <p class="muted">Unknown means the saved data cannot establish the answer. Old records are not retroactively classified as human moves. Account type is captured at match start only when verified; guest expiry, storage clearing and switching devices can make the same person appear as different accounts. Linked accounts keep their existing identity. This report contains aggregates only and sends no network requests.</p></main></html>`;
}
