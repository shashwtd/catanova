import { useState } from 'react';
import type {
  AdminStats,
  Cached,
  DiceSummary,
  Metric,
  RetentionReport,
} from '../../server/src/admin/types.js';
import { api, ApiError, useApi } from '../api.js';
import { count, dateAxis, dayLabel, diceLabel, minutes, percent, time, weekLabel } from '../format.js';
import { Columns, countMax, Empty, Failure, Loading, Section, Stat, Table, Tabs } from '../ui.js';
import { PairGrid, totalDice } from '../dice.js';

const TOTALS = Array.from({ length: 11 }, (_, i) => String(i + 2));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** A dice chart's column by name: "Total 7". */
export const totalLabel = (index: number) => `Total ${index + 2}`;
/** Rolls are whole; an expectation reads to a tenth. */
export const rollCount = (value: number) => (Number.isInteger(value) ? count(value) : value.toFixed(1));

export function DiceTable({ dice }: { dice: DiceSummary }) {
  return (
    <Table className="compact">
      <thead>
        <tr>
          <th>Total</th>
          {TOTALS.map((total) => (
            <th key={total} className="num">
              {total}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Rolled</th>
          {dice.counts.map((n, i) => (
            <td key={i} className="num">
              {n}
            </td>
          ))}
        </tr>
        <tr>
          <th>{expectationName(dice)}</th>
          {dice.expected.map((n, i) => (
            <td key={i} className="num muted">
              {Math.round(n)}
            </td>
          ))}
        </tr>
      </tbody>
    </Table>
  );
}

/** What the numbers say about the dice, and only what a test of them can say. */
export function fairness(dice: DiceSummary): string {
  if (!dice.rolls) return 'No rolls yet.';
  if (dice.model === 'deck')
    return 'Balanced dice are drawn from a deck of all 36 pairs, so their totals follow the curve by design; a χ² test of independent dice does not apply.';
  if (dice.model === 'mixed')
    return 'These rolls mix dice modes, so no single test applies: the expectation adds up each mode’s own, and each mode is judged on its own below.';
  const subject = dice.model === 'flat' ? 'equally likely totals' : 'fair, independent dice';
  return `χ² ${dice.chiSquare} over 10 degrees of freedom, p = ${dice.pValue}. ${
    dice.pValue !== null && dice.pValue < 0.01 ? `Unlikely from ${subject}.` : `Consistent with ${subject}.`
  }`;
}

/** The expectation's name in charts and tables. */
export const expectationName = (dice: DiceSummary) =>
  dice.model === 'flat' ? 'Equal totals' : dice.model === 'mixed' ? 'Expected' : 'Two fair dice';

function Retention() {
  const [days, setDays] = useState<'7' | '14' | '30' | '90'>('30');
  const cached = useApi<{ days: number; report: Cached<RetentionReport> | null }>(
    `/api/admin/reports/retention?days=${days}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const report = cached.data?.report ?? null;
  const generate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/admin/reports/retention', { method: 'POST', body: { days: Number(days) } });
      cached.reload();
    } catch (problem) {
      setError(problem instanceof ApiError ? problem : undefined);
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.value.csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `catanova-retention-${days}d-${new Date(report.value.generatedAt).toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const sections = report ? [...new Set(report.value.metrics.map((metric) => metric.section))] : [];
  return (
    <Section
      title="Retention report"
      className="wide"
      actions={
        <Tabs
          label="Report window"
          value={days}
          onChange={setDays}
          options={(['7', '14', '30', '90'] as const).map((value) => ({ value, label: `${value} days` }))}
        />
      }
    >
      <p className="muted">
        The private retention report from <code>scripts/reporting</code>, run on demand against the live
        database in a background worker and kept for ten minutes. Matches that started in the last {days}{' '}
        days; aggregates only. Generating it is recorded in the audit log.
      </p>
      <div className="toolbar">
        <button type="button" className="button" disabled={busy} onClick={() => void generate()}>
          {busy ? 'Generating…' : report ? 'Generate again' : 'Generate report'}
        </button>
        {report && (
          <>
            <span className="muted">Generated {time(report.cachedAt)}</span>
            <button type="button" className="button" onClick={download}>
              Download CSV
            </button>
          </>
        )}
      </div>
      <Failure error={error ?? cached.error} />
      {report &&
        sections.map((section) => (
          <div key={section} className="report-section">
            <h3>{section.replace('humanOnly', 'human only').replace('withBots', 'with bots')}</h3>
            <Table className="compact metrics">
              <colgroup>
                <col />
                <col className="metric-value" />
                <col className="metric-share" />
              </colgroup>
              <tbody>
                {report.value.metrics
                  .filter((metric) => metric.section === section)
                  .map((metric: Metric) => (
                    <tr key={metric.metric}>
                      <th>{metric.metric}</th>
                      <td className="num">
                        {metric.value === null
                          ? '—'
                          : Number.isInteger(metric.value)
                            ? count(metric.value)
                            : metric.value.toFixed(1)}
                        {metric.unit && metric.value !== null ? ` ${metric.unit}` : ''}
                      </td>
                      <td className="num muted">
                        {metric.denominator === undefined
                          ? ''
                          : metric.unit
                            ? `n = ${metric.denominator}`
                            : `of ${metric.denominator} (${percent(metric.value ?? 0, metric.denominator)})`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </div>
        ))}
    </Section>
  );
}

export function Stats() {
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading, reload } = useApi<Cached<AdminStats>>(
    `/api/admin/stats${refresh ? `?refresh=1&n=${refresh}` : ''}`,
  );
  const stats = data?.value;
  const days = stats?.days.map((day) => day.day) ?? [];
  const weeks = stats?.weeks.map((week) => week.week) ?? [];
  const gamesMax = countMax(
    Math.max(1, ...(stats?.days ?? []).flatMap((day) => [day.started, day.finished + day.abandoned])),
  );
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted">
          {stats
            ? `Computed ${time(stats.generatedAt)} in a background worker; kept for five minutes.`
            : 'Computing…'}
        </p>
        <button type="button" className="button" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
          Recompute
        </button>
      </div>
      <Failure error={error} retry={reload} />
      {!stats ? (
        !error && <Loading label="Computing statistics…" />
      ) : (
        <>
          <div className="grid">
            <Section title="All time">
              <div className="stats">
                <Stat label="Matches" value={count(stats.totals.matches)} />
                <Stat label="Finished" value={count(stats.totals.finished)} hint="with a winner" />
                <Stat label="Abandoned" value={count(stats.totals.abandoned)} />
                <Stat label="In progress" value={count(stats.totals.running)} />
                <Stat label="Accounts" value={count(stats.totals.accounts)} hint="ever seated" />
                <Stat
                  label="Unindexed"
                  value={count(stats.totals.unindexedGames)}
                  hint="saved games not in records"
                />
              </div>
            </Section>
            <Section title="Last 30 days">
              <div className="stats">
                <Stat
                  label="Median game"
                  value={minutes(stats.completed.medianMinutes)}
                  hint={`${stats.completed.medianTurns ?? '—'} turns · ${count(stats.completed.count)} finished`}
                />
                <Stat
                  label="Bot seats"
                  value={percent(stats.bots.botSeats, stats.bots.seats)}
                  hint={`${count(stats.bots.botSeats)} of ${count(stats.bots.seats)} seats`}
                />
                <Stat
                  label="Games with bots"
                  value={percent(stats.bots.matchesWithBots, stats.bots.matches)}
                  hint={`${count(stats.bots.matchesWithBots)} of ${count(stats.bots.matches)}`}
                />
              </div>
            </Section>
          </div>
          {/* Games and players, each pair side by side; the two game charts share a scale. */}
          <div className="duo">
            <Section
              title="Games started per day"
              actions={
                <span className="card-note">
                  {count(sum(stats.days.map((day) => day.started)))} in 30 days
                </span>
              }
            >
              <Columns
                label="Games started per day over the last 30 days"
                categories={days}
                axis={(band) => dateAxis(days, band)}
                pointLabel={(i) => dayLabel(days[i]!)}
                series={[{ name: 'Started', slot: 1, values: stats.days.map((day) => day.started) }]}
                max={gamesMax}
              />
            </Section>
            <Section
              title="Games ended per day"
              actions={
                <span className="card-note">
                  {count(sum(stats.days.map((day) => day.finished)))} finished ·{' '}
                  {count(sum(stats.days.map((day) => day.abandoned)))} abandoned
                </span>
              }
            >
              <Columns
                label="Games finished and abandoned per day over the last 30 days"
                categories={days}
                axis={(band) => dateAxis(days, band)}
                pointLabel={(i) => dayLabel(days[i]!)}
                series={[
                  { name: 'Finished', slot: 3, values: stats.days.map((day) => day.finished) },
                  { name: 'Abandoned', slot: 2, values: stats.days.map((day) => day.abandoned) },
                ]}
                max={gamesMax}
              />
            </Section>
          </div>
          <div className="duo">
            <Section
              title="Players per day"
              actions={
                <span className="card-note">
                  up to {count(Math.max(0, ...stats.days.map((day) => day.players)))} a day
                </span>
              }
            >
              <Columns
                label="Distinct accounts that played each day"
                categories={days}
                axis={(band) => dateAxis(days, band)}
                pointLabel={(i) => dayLabel(days[i]!)}
                series={[{ name: 'Players', slot: 1, values: stats.days.map((day) => day.players) }]}
              />
            </Section>
            <Section
              title="Players per week"
              actions={<span className="card-note">{count(stats.weeks.at(-1)?.players ?? 0)} this week</span>}
            >
              <Columns
                label="Distinct accounts that played each week"
                categories={weeks}
                axis={(band) => dateAxis(weeks, band, 'week')}
                pointLabel={(i) => weekLabel(weeks[i]!)}
                series={[{ name: 'Players', slot: 1, values: stats.weeks.map((week) => week.players) }]}
                table="Week (UTC)"
              />
            </Section>
          </div>
          <p className="footnote">
            Days and weeks are UTC; weeks start on Monday. Players are distinct accounts that started a match
            that day or week; local seats without an account are not counted.
          </p>
          <details className="card wide">
            <summary>Daily numbers</summary>
            <Table className="compact">
              <thead>
                <tr>
                  <th>Day (UTC)</th>
                  <th className="num">Started</th>
                  <th className="num">Finished</th>
                  <th className="num">Abandoned</th>
                  <th className="num">Players</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.days].reverse().map((day) => (
                  <tr key={day.day}>
                    <td className="nowrap">{dayLabel(day.day)}</td>
                    <td className="num">{day.started}</td>
                    <td className="num">{day.finished}</td>
                    <td className="num">{day.abandoned}</td>
                    <td className="num">{day.players}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
          <Section title={`Dice, all games (${count(stats.dice.overall.rolls)} rolls)`} className="wide">
            {stats.dice.overall.rolls ? (
              <>
                <div className="duo dice-views">
                  <div>
                    <h3>Totals</h3>
                    <Columns
                      label={`Rolls of each total across every game, against ${expectationName(stats.dice.overall).toLowerCase()}`}
                      categories={TOTALS}
                      pointLabel={totalLabel}
                      format={rollCount}
                      series={[{ name: 'Rolled', slot: 1, values: stats.dice.overall.counts }]}
                      reference={{
                        name: expectationName(stats.dice.overall),
                        values: stats.dice.overall.expected,
                      }}
                      below={totalDice((i) => i + 2)}
                      height={230}
                    />
                    <p className="muted">{fairness(stats.dice.overall)}</p>
                  </div>
                  {stats.dice.overall.pairs && (
                    <div>
                      <h3>Which pairs came up</h3>
                      <PairGrid
                        dice={stats.dice.overall}
                        label="How often each pair of dice came up across every game, first die by second"
                      />
                    </div>
                  )}
                </div>
                <DiceTable dice={stats.dice.overall} />
                {Object.keys(stats.dice.byMode).length > 1 &&
                  Object.entries(stats.dice.byMode).map(([mode, dice]) => (
                    <div key={mode} className="report-section">
                      <h3>
                        {diceLabel(mode)} dice · {count(dice.rolls)} rolls
                      </h3>
                      <p className="muted">{fairness(dice)}</p>
                      <DiceTable dice={dice} />
                    </div>
                  ))}
                <p className="footnote">
                  Each roll counts under the dice its own game was played with, whatever the room is set to
                  now.
                </p>
              </>
            ) : (
              <Empty>No rolls yet.</Empty>
            )}
          </Section>
        </>
      )}
      <Retention />
    </div>
  );
}
