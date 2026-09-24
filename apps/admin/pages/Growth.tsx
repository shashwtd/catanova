/**
 * Growth: how Catanova is growing. The range's headline numbers with their
 * change against the period before and a sparkline each, then accounts, new
 * and active players, games, how long games last and how many seats bots
 * fill, by day, week or month, and weekly retention of new players. Worked
 * out in the analysis worker from the match index (growth.ts): aggregates
 * only, nothing per account.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Cached,
  GrowthPeriod,
  GrowthRange,
  GrowthReport,
  GrowthSeries,
} from '../../server/src/admin/types.js';
import { useApi } from '../api.js';
import { go } from '../route.js';
import {
  change,
  count,
  dateAxis,
  dayLabel,
  dayMonth,
  isoDay,
  minutes,
  monthLabel,
  percent,
  points,
  time,
  utcDay,
  weekLabel,
} from '../format.js';
import {
  Columns,
  Empty,
  Failure,
  Heatmap,
  LineChart,
  Loading,
  Notice,
  Section,
  Tabs,
  TrendStat,
} from '../ui.js';
import type { Delta, HeatCell } from '../ui.js';
import { Settlement } from '../art.js';

const DAY = 86_400_000;

export const RANGES: { value: GrowthRange; label: string; days: number | null }[] = [
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '1y', label: '1 year', days: 365 },
  { value: 'all', label: 'All time', days: null },
];

export type Unit = 'day' | 'week' | 'month';

/** A stretch of one series, every field cut the same way. */
export function sliceSeries(series: GrowthSeries, from: number, to = series.start.length): GrowthSeries {
  const cut = <T,>(values: T[]) => values.slice(from, to);
  return {
    start: cut(series.start),
    started: cut(series.started),
    finished: cut(series.finished),
    abandoned: cut(series.abandoned),
    active: cut(series.active),
    trailing: cut(series.trailing),
    newPlayers: cut(series.newPlayers),
    accounts: cut(series.accounts),
    seats: cut(series.seats),
    botSeats: cut(series.botSeats),
    withBots: cut(series.withBots),
    lengths: {
      games: cut(series.lengths.games),
      median: cut(series.lengths.median),
      low: cut(series.lengths.low),
      high: cut(series.lengths.high),
    },
  };
}

/** The mean of each value with the `window - 1` before it, to a tenth; null until there are that many. */
export function movingAverage(values: number[], window: number): (number | null)[] {
  let sum = 0;
  return values.map((value, i) => {
    sum += value - (i >= window ? values[i - window]! : 0);
    return i + 1 < window ? null : Math.round((sum / window) * 10) / 10;
  });
}

/**
 * How a range is drawn: by day up to 90 days, by week up to two years, and
 * by month beyond; with the trend's window (7 days, 4 weeks or 3 months)
 * worked out over the whole series so a range's first points have one too.
 */
export function rangeView(report: GrowthReport, range: GrowthRange) {
  const option = RANGES.find((candidate) => candidate.value === range)!;
  const first = report.firstGameAt ?? Date.now();
  let unit: Unit;
  let full: GrowthSeries;
  let from: number;
  if (option.days !== null && option.days <= 90) {
    unit = 'day';
    full = report.days;
    from = full.start.length - option.days;
  } else if (option.days !== null) {
    unit = 'week';
    full = report.weeks;
    from = Math.max(0, full.start.length - 52);
  } else {
    const weeks = report.weeks.start.filter((start) => utcDay(start) + 7 * DAY > first).length;
    unit = weeks > 104 ? 'month' : 'week';
    full = unit === 'month' ? report.months : report.weeks;
    from = Math.max(
      0,
      full.start.findIndex((_, i) => i === full.start.length - 1 || utcDay(full.start[i + 1]!) > first),
    );
  }
  const window = unit === 'day' ? 7 : unit === 'week' ? 4 : 3;
  // The last bucket (today, this week or this month) is still under way: an average leaves it out
  // rather than bending down at the end.
  const average = (values: number[]) => [...movingAverage(values.slice(0, -1), window).slice(from), null];
  const series = sliceSeries(full, from);
  const last = series.start.length - 1;
  const name = (start: string) =>
    unit === 'day' ? dayLabel(start) : unit === 'week' ? weekLabel(start) : monthLabel(start);
  return {
    unit,
    series,
    /** The bucket still under way: the last. */
    partial: last,
    /** A count series without the bucket still under way, for a sparkline that does not dip at its end. */
    complete: (values: (number | null)[]) => values.slice(0, -1),
    /** A bucket in full, the last one saying it is not over. */
    label: (i: number) => `${name(series.start[i]!)}${i === last ? ', so far' : ''}`,
    averageName: unit === 'day' ? '7-day average' : unit === 'week' ? '4-week average' : '3-month average',
    /** Accounts that played in the trailing window to today: 7 days for days, 28 for weeks and months. */
    trailing: { players: full.trailing.at(-1) ?? 0, days: unit === 'day' ? 7 : 28 },
    average: {
      started: average(full.started),
      finished: average(full.finished),
      newPlayers: average(full.newPlayers),
      active: average(full.active),
    },
  };
}

/** A bucket's share, as a percentage to a tenth, or null where there is nothing to share. */
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** The change of a headline number against the period before, or nothing when there is no period before. */
function versus(
  current: number | null,
  previous: number | null | undefined,
  against: string | null,
  good: boolean | null,
  kind: 'change' | 'points' = 'change',
): Delta | undefined {
  if (against === null || previous === undefined) return undefined;
  const text =
    current === null || previous === null
      ? null
      : kind === 'change'
        ? change(current, previous)
        : points(current, previous);
  return { text, against, good };
}

function Tiles({
  period,
  previous,
  range,
  view,
  cohorts,
}: {
  period: GrowthPeriod;
  previous: GrowthPeriod | null;
  range: (typeof RANGES)[number];
  view: ReturnType<typeof rangeView>;
  cohorts: { rate: number | null }[];
}) {
  const against = range.days === null || !previous ? null : `vs the ${range.label} before`;
  const { series, unit, complete } = view;
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const perBucket = (values: number[]) => `about ${count(Math.round(mean(values)))} a ${unit}`;
  const botShare = share(period.botSeats, period.seats);
  const returned = share(period.nextWeek.returned, period.nextWeek.players);
  return (
    <div className="kpis trend-stats">
      <TrendStat
        label="Accounts"
        value={count(period.accountsAfter)}
        delta={
          range.days === null
            ? undefined
            : {
                text: change(period.accountsAfter, period.accountsBefore),
                against: `in ${range.label}`,
                good: true,
              }
        }
        hint={
          range.days === null
            ? 'that have played a game'
            : `${count(period.newPlayers)} new in ${range.label}`
        }
        spark={series.accounts}
        zero={false}
      />
      <TrendStat
        label="New players"
        value={count(period.newPlayers)}
        delta={versus(period.newPlayers, previous?.newPlayers, against, true)}
        hint={
          range.days === null
            ? perBucket(series.newPlayers)
            : `${percent(period.newPlayers, period.active)} of active players`
        }
        spark={complete(series.newPlayers)}
      />
      <TrendStat
        label="Active players"
        value={count(period.active)}
        delta={versus(period.active, previous?.active, against, true)}
        hint={perBucket(series.active)}
        spark={complete(series.active)}
      />
      <TrendStat
        label="Games started"
        value={count(period.started)}
        delta={versus(period.started, previous?.started, against, true)}
        hint={perBucket(series.started)}
        spark={complete(series.started)}
      />
      <TrendStat
        label="Games won"
        value={count(period.finished)}
        delta={versus(period.finished, previous?.finished, against, true)}
        hint={`${percent(period.finished, period.finished + period.abandoned)} had a winner`}
        spark={complete(series.finished)}
      />
      <TrendStat
        label="Median game"
        value={minutes(period.medianMinutes)}
        delta={versus(period.medianMinutes, previous?.medianMinutes, against, null)}
        hint={`of ${count(period.lengthGames)} won`}
        spark={series.lengths.median}
        zero={false}
      />
      <TrendStat
        label="Bot seats"
        value={botShare === null ? '—' : `${botShare}%`}
        delta={versus(
          botShare,
          previous ? share(previous.botSeats, previous.seats) : undefined,
          against,
          null,
          'points',
        )}
        hint={`${count(period.withBots)} games had a bot`}
        spark={series.seats.map((seats, i) => share(series.botSeats[i]!, seats))}
        zero={false}
      />
      <TrendStat
        label="Back the next week"
        value={returned === null ? '—' : `${returned}%`}
        delta={versus(
          returned,
          previous ? share(previous.nextWeek.returned, previous.nextWeek.players) : undefined,
          against,
          true,
          'points',
        )}
        hint={`${count(period.nextWeek.returned)} of ${count(period.nextWeek.players)} new`}
        spark={cohorts.length >= 4 ? cohorts.map((cohort) => cohort.rate) : undefined}
        zero={false}
      />
    </div>
  );
}

/** The weeks after the first shown in the retention grid. */
const RETENTION_WEEKS = 12;

function Retention({ report, from }: { report: GrowthReport; from: number }) {
  const cohorts = report.cohorts.filter((cohort) => utcDay(cohort.week) + 7 * DAY > from);
  const shown = Math.min(RETENTION_WEEKS, Math.max(1, ...cohorts.map((cohort) => cohort.active.length - 1)));
  const columns = Array.from({ length: shown }, (_, i) => i + 1);
  const cells: HeatCell[][] = cohorts.map((cohort) =>
    columns.map((k) => {
      const size = cohort.active[0]!;
      if (!size || k >= cohort.active.length) return null;
      const rate = (cohort.active[k]! / size) * 100;
      return { value: rate, text: `${Math.round(rate)}`, partial: k === cohort.active.length - 1 };
    }),
  );
  const top = Math.max(10, Math.ceil(Math.max(0, ...cells.flat().map((cell) => cell?.value ?? 0)) / 10) * 10);
  if (!cohorts.some((cohort) => cohort.active[0])) return <Empty>No new players in this range yet.</Empty>;
  return (
    <Heatmap
      label="Weekly retention: of each week’s new players, the share that played in each week after their first"
      rows={cohorts.map((cohort) => ({
        key: cohort.week,
        label: dayMonth(cohort.week),
        aside: count(cohort.active[0]!),
      }))}
      columns={columns.map((k) => ({ key: String(k), label: String(k) }))}
      cells={cells}
      max={top}
      rowTitle="first week"
      asideTitle="new"
      columnTitle="weeks after their first"
      labelWidth={52}
      cellHeight={22}
      maxCell={64}
      scale={{ low: '0%', high: `${top}%` }}
      tip={(r, c) => {
        const cohort = cohorts[r]!;
        const k = columns[c]!;
        const cell = cells[r]![c]!;
        return {
          title: `${weekLabel(cohort.week)}, ${k === 1 ? 'the next week' : `${k} weeks on`}`,
          rows: [
            {
              mark: 'none',
              paint: 'ink',
              value: `${(Math.round(cell!.value * 10) / 10).toFixed(1)}%`,
              name: `played: ${count(cohort.active[k]!)} of ${count(cohort.active[0]!)}`,
            },
            ...(cell!.partial
              ? [
                  {
                    mark: 'none' as const,
                    paint: 'ink' as const,
                    value: '',
                    name: 'that week is still under way',
                  },
                ]
              : []),
          ],
        };
      }}
      table={{
        head: 'First week',
        row: (r) => `${weekLabel(cohorts[r]!.week)} (${count(cohorts[r]!.active[0]!)} new)`,
        value: (r, c) => {
          const cell = cells[r]![c];
          return cell ? `${(Math.round(cell.value * 10) / 10).toFixed(1)}%` : '—';
        },
      }}
    />
  );
}

/** A card's figure beside its title. */
const note = (text: ReactNode) => <span className="card-note">{text}</span>;

export function Growth({ params }: { params: URLSearchParams }) {
  const range = (RANGES.find((option) => option.value === params.get('range'))?.value ??
    '90d') as GrowthRange;
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading, reload } = useApi<Cached<GrowthReport>>(
    `/api/admin/growth${refresh ? `?refresh=1&n=${refresh}` : ''}`,
  );
  const report = data?.value;
  const option = RANGES.find((candidate) => candidate.value === range)!;
  const toolbar = (
    <div className="toolbar">
      <Tabs
        label="Range"
        value={range}
        onChange={(value) =>
          go('growth', undefined, new URLSearchParams(value === '90d' ? {} : { range: value }))
        }
        options={RANGES.map((candidate) => ({ value: candidate.value, label: candidate.label }))}
      />
      <span className="toolbar-end">
        <span className="muted small">
          {report ? `Worked out ${time(report.generatedAt)}; kept for five minutes` : 'Working out…'}
        </span>
        <button type="button" className="button" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
          Recompute
        </button>
      </span>
    </div>
  );
  if (!report)
    return (
      <div className="stack">
        {toolbar}
        <Failure error={error} retry={reload} />
        {!error && <Loading label="Working out growth…" />}
      </div>
    );
  if (report.firstGameAt === null)
    return (
      <div className="stack">
        {toolbar}
        <Empty art={<Settlement live={0} />}>No games yet. Growth starts with the first one.</Empty>
      </div>
    );
  const view = rangeView(report, range);
  const { series, unit, label } = view;
  const { current, previous } = report.periods[range];
  const x = series.start.map(utcDay);
  const axis = (band: number) => dateAxis(series.start, band, unit);
  const lineAxis = (width: number) => {
    const pick = dateAxis(series.start, width / Math.max(1, series.start.length), unit);
    return x.flatMap((at, i) => {
      const text = pick(i);
      return text === null ? [] : [{ x: at, label: text }];
    });
  };
  const pointLabel = (at: number) => label(x.indexOf(at));
  const inRange =
    option.days === null ? `since ${dayMonth(isoDay(report.firstGameAt))}` : `in ${option.label}`;
  const retentionFrom = option.days === null ? 0 : report.generatedAt - option.days * DAY;
  const cohortRates = report.cohorts
    .filter((cohort) => utcDay(cohort.week) + 7 * DAY > retentionFrom && cohort.active.length > 2)
    .map((cohort) => ({ rate: share(cohort.active[1]!, cohort.active[0]!) }));
  const bucket = `Per ${unit}`;
  return (
    <div className="stack">
      {toolbar}
      <Failure error={error} retry={reload} />
      {current.started === 0 && <Notice>No games started {inRange}.</Notice>}
      <Tiles period={current} previous={previous} range={option} view={view} cohorts={cohortRates} />
      <div className="duo">
        <Section
          title="Accounts"
          actions={note(`${count(current.accountsAfter)} · ${count(current.newPlayers)} new ${inRange}`)}
        >
          <LineChart
            label={`Accounts that had played a game, ${unit} by ${unit}`}
            x={x}
            series={[{ name: 'Accounts', slot: 1, values: series.accounts }]}
            axis={lineAxis}
            pointLabel={pointLabel}
            format={count}
            xTitle={unit === 'day' ? 'Day (UTC)' : unit === 'week' ? 'Week (UTC)' : 'Month (UTC)'}
            yTitle="accounts"
            area
            integer
            height={170}
          />
        </Section>
        <Section title="New players" actions={note(`${count(current.newPlayers)} ${inRange}`)}>
          <Columns
            label={`New players per ${unit}: accounts whose first game started then`}
            categories={series.start}
            axis={axis}
            pointLabel={label}
            series={[{ name: 'New players', slot: 1, values: series.newPlayers }]}
            lines={[{ name: view.averageName, paint: 'ink', values: view.average.newPlayers }]}
            soft
            height={170}
            table={bucket}
            partial={view.partial}
          />
        </Section>
      </div>
      <div className="duo">
        <Section
          title="Active players"
          actions={note(
            `${count(current.active)} ${inRange} · ${count(view.trailing.players)} in the last ${view.trailing.days} days`,
          )}
        >
          <Columns
            label={`Active players per ${unit}: accounts that started a game then`}
            categories={series.start}
            axis={axis}
            pointLabel={label}
            series={[{ name: `Played that ${unit}`, slot: 1, values: series.active }]}
            lines={[{ name: view.averageName, paint: 'ink', values: view.average.active }]}
            soft
            height={170}
            table={bucket}
            partial={view.partial}
          />
        </Section>
        <Section
          title="Games"
          actions={note(`${count(current.started)} started · ${count(current.finished)} won ${inRange}`)}
        >
          <Columns
            label={`Games started per ${unit}, with the trend of games started and won`}
            categories={series.start}
            axis={axis}
            pointLabel={label}
            series={[{ name: 'Started', slot: 1, values: series.started }]}
            lines={[
              { name: `Started, ${view.averageName}`, paint: 'ink', values: view.average.started },
              { name: `Won, ${view.averageName}`, paint: 3, values: view.average.finished },
            ]}
            extra={(i) => [
              { mark: 'none', paint: 'ink', value: count(series.finished[i]!), name: 'won' },
              {
                mark: 'none',
                paint: 'ink',
                value: count(series.abandoned[i]!),
                name: 'ended with no winner',
              },
            ]}
            soft
            height={170}
            table={bucket}
            partial={view.partial}
          />
        </Section>
      </div>
      <div className="duo">
        <Section title="Game length" actions={note(`median ${minutes(current.medianMinutes)}`)}>
          <LineChart
            label={`Length of games won, per ${unit}: the median and the middle half, in minutes`}
            x={x}
            series={[{ name: 'Median', slot: 1, values: series.lengths.median }]}
            band={{ name: 'Middle half', slot: 1, lower: series.lengths.low, upper: series.lengths.high }}
            axis={lineAxis}
            pointLabel={pointLabel}
            format={(value) => minutes(value)}
            xTitle={bucket}
            yTitle="minutes"
            yMin={30}
            height={170}
          />
        </Section>
        <Section
          title="Bot seats"
          actions={note(`${share(current.botSeats, current.seats) ?? '—'}% of seats ${inRange}`)}
        >
          <LineChart
            label={`Share of seats bots filled, and of games with a bot, per ${unit}`}
            x={x}
            series={[
              {
                name: 'Bot seats',
                slot: 1,
                values: series.seats.map((seats, i) => share(series.botSeats[i]!, seats)),
              },
              {
                name: 'Games with bots',
                slot: 2,
                values: series.started.map((started, i) => share(series.withBots[i]!, started)),
              },
            ]}
            axis={lineAxis}
            pointLabel={pointLabel}
            format={(value) => `${value}%`}
            xTitle={bucket}
            yTitle="%"
            yMin={10}
            height={170}
          />
        </Section>
      </div>
      <Section
        title="Weekly retention"
        actions={
          current.nextWeek.players
            ? note(
                `${share(current.nextWeek.returned, current.nextWeek.players)}% back the next week ${inRange}`,
              )
            : undefined
        }
      >
        <p className="footnote first">
          Each row is the players whose first game was that week, and each cell the share of them who played
          in a later week; the last cell of each row is a week still under way. For returns within 24–48 hours
          and groups who play again together, generate the private retention report on{' '}
          <a href="#/stats">Stats</a>.
        </p>
        <Retention report={report} from={retentionFrom} />
      </Section>
      <p className="footnote">
        Days, weeks (from Monday) and months are UTC, and the last one is still under way. A player is an
        account that started a game, from its first game on; local seats and bots are not players. Games count
        by when they started, and as won or ended with no winner by when they ended. Game length runs from the
        first move to the last, pauses included, for games won.{' '}
        {range !== 'all' &&
          (previous
            ? `Changes compare with the ${option.label} before.`
            : `There are no games before this range to compare it with.`)}
      </p>
    </div>
  );
}
