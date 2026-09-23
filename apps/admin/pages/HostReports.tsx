/** The host's backup, watchdog and restore-drill reports, in full or as a line each. */
import type { AdminSystem, StatusFile } from '../../server/src/admin/types.js';
import { time } from '../format.js';
import { HOST_REPORTS, reportFields, reportVerdict, reportedAt } from '../host-reports.js';
import { Badge, When } from '../ui.js';

type Report = (typeof HOST_REPORTS)[number];

function HostReport({ report, file, now }: { report: Report; file: StatusFile; now: number }) {
  const verdict = reportVerdict(file, now, report.staleAfterMs);
  return (
    <div className="status-report">
      <div className="status-title">
        <strong>{report.name}</strong>
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
      </div>
      {file.state === 'missing' && <p className="muted">No report yet from the host.</p>}
      {file.state === 'invalid' && (
        <p className="muted">
          {file.error}
          {file.modifiedAt ? ` · written ${time(file.modifiedAt)}` : ''}
        </p>
      )}
      {file.state === 'ok' && (
        <dl className="pairs">
          <div className="pair">
            <dt>Ran</dt>
            <dd>
              <When at={reportedAt(file)} now={now} /> · runs {report.every}
            </dd>
          </div>
          {reportFields(file)
            .slice(0, 12)
            .map((field) => (
              <div key={field.key} className="pair">
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

/** All three reports, each with its fields. */
export function HostReports({ status, now }: { status: AdminSystem['status']; now: number }) {
  return (
    <>
      <div className="reports">
        {HOST_REPORTS.map((report) => (
          <HostReport key={report.key} report={report} file={status[report.key]} now={now} />
        ))}
      </div>
      <p className="footnote">
        Read from <code className="path">{status.directory}</code>, where the host&rsquo;s scripts write them.
      </p>
    </>
  );
}

/** One line per report: its verdict and when its job last ran. */
export function HostReportLines({ status, now }: { status: AdminSystem['status']; now: number }) {
  return (
    <ul className="plain report-lines">
      {HOST_REPORTS.map((report) => {
        const file = status[report.key];
        const verdict = reportVerdict(file, now, report.staleAfterMs);
        return (
          <li key={report.key}>
            <span className="report-name">{report.name}</span>
            <Badge tone={verdict.tone}>{verdict.label}</Badge>
            <span className="muted">
              {file.state === 'ok' ? (
                <>
                  ran <When at={reportedAt(file)} now={now} />
                </>
              ) : file.state === 'missing' ? (
                'no report yet'
              ) : (
                file.error
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
