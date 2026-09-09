import { COSTS } from '../../../packages/rules/src/index.js';
import { ArrowRight, Castle, Dices, House, Route, ScrollText, Shield, Trophy } from './GameIcons.js';
import { ResourceSummary } from './ResourcePicker.js';

export function QuickRules() {
  return (
    <div className="rules-book">
      <div className="rules-victory">
        <Trophy size={32} />
        <div>
          <strong>First to 10 victory points</strong>
          <p>Win on your turn.</p>
        </div>
      </div>
      <dl className="rules-scores" aria-label="Building points">
        <div>
          <dt>
            <House />
            Settlement
          </dt>
          <dd>1 VP</dd>
        </div>
        <div>
          <dt>
            <Castle />
            City
          </dt>
          <dd>2 VP</dd>
        </div>
      </dl>
      <div className="rules-awards">
        <section>
          <div>
            <Route />
            <strong>Longest Road</strong>
            <b>+2 VP</b>
          </div>
          <p>Longest continuous route: at least 5 connected roads.</p>
        </section>
        <section>
          <div>
            <Shield />
            <strong>Largest Army</strong>
            <b>+2 VP</b>
          </div>
          <p>Most Knights played: at least 3 Knights.</p>
        </section>
      </div>
      <div className="rules-rhythm">
        <Dices />
        <span>Roll</span>
        <ArrowRight />
        <span>Collect</span>
        <ArrowRight />
        <span>Trade & build</span>
      </div>
      <section className="rules-build">
        <h3>Build costs</h3>
        <dl className="rules-costs">
          {(['road', 'settlement', 'city', 'developmentCard'] as const).map((kind) => {
            const Icon =
              kind === 'road' ? Route : kind === 'settlement' ? House : kind === 'city' ? Castle : ScrollText;
            const label =
              kind === 'developmentCard'
                ? 'Development card'
                : kind === 'city'
                  ? 'City upgrade'
                  : kind === 'road'
                    ? 'Road'
                    : 'Settlement';
            return (
              <div key={kind} className="build-recipe">
                <dt>
                  <Icon />
                  <span>{label}</span>
                </dt>
                <dd>
                  <span className="recipe-pay">Pay</span>
                  <ResourceSummary hand={COSTS[kind]} />
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
      <div className="rules-notes">
        <p>
          <b>City upgrade</b> Replaces your settlement. Collect 2 resources instead of 1.
        </p>
        <p>
          <b>Roll a 7?</b> Over 7 resource cards? Discard half, rounded down. Move the robber and steal a
          card.
        </p>
        <p>
          <b>Development cards</b> Play one per turn, from your next turn. Victory-point cards count
          immediately.
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
