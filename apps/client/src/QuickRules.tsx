import { COSTS } from '../../../packages/rules/src/index.js';
import { ArrowRight, Castle, Dices, House, Route, ScrollText, Shield, Trophy } from './GameIcons.js';
import { ResourceSummary } from './ResourcePicker.js';

export function QuickRules() {
  return (
    <div className="rules-book">
      <div className="rules-victory">
        <Trophy size={44} />
        <div>
          <strong>First to 10</strong>
          <p>Win on your turn.</p>
        </div>
      </div>
      <div className="rules-scores">
        <span>
          <House />
          <b>1</b>
        </span>
        <span>
          <Castle />
          <b>2</b>
        </span>
        <span>
          <Route />
          <b>+2</b>
        </span>
        <span>
          <Shield />
          <b>+2</b>
        </span>
      </div>
      <div className="rules-rhythm">
        <Dices />
        <span>Roll</span>
        <ArrowRight />
        <span>Collect</span>
        <ArrowRight />
        <span>Trade & build</span>
      </div>
      <dl className="rules-costs">
        {(['road', 'settlement', 'city', 'developmentCard'] as const).map((kind) => {
          const Icon =
            kind === 'road' ? Route : kind === 'settlement' ? House : kind === 'city' ? Castle : ScrollText;
          return (
            <div key={kind}>
              <dt>
                <Icon />
                {kind === 'developmentCard'
                  ? 'Development'
                  : kind === 'city'
                    ? 'City'
                    : kind === 'road'
                      ? 'Road'
                      : 'Settlement'}
              </dt>
              <dd>
                <ResourceSummary hand={COSTS[kind]} />
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="rules-notes">
        <p>
          <b>Roll a 7?</b> Hands over 7 discard half. Move the robber and steal.
        </p>
        <p>
          <b>Development cards</b> Play one per turn, starting on your next turn. Victory points count
          immediately.
        </p>
        <p>
          <b>Awards</b> Longest Road starts at 5 roads; Largest Army at 3 knights. Each is worth 2 points.
        </p>
      </div>
      <a
        className="dark-button rulebook-link"
        href="https://github.com/shashwtd/catanova/blob/main/docs/RULEBOOK.md"
        target="_blank"
        rel="noreferrer"
      >
        Full rulebook <ArrowRight />
      </a>
    </div>
  );
}
