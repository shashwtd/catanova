import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_VICTORY_POINTS } from '../../../packages/rules/src/victory.js';
import { COSTS } from '../../../packages/rules/src/index.js';
import { Castle, Dices, House, Route, ScrollText, Shield, Trophy, Robber, NextTurn } from './GameIcons.js';
import { ResourceSummary } from './ResourcePicker.js';

function GuideSection({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="guide-section t-acc" data-open={open}>
      <button className="t-acc-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {icon}
        <span>{title}</span>
        <span className="t-acc-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M4 6.5L8 10.5L12 6.5" />
          </svg>
        </span>
      </button>
      <div id={id} className="t-acc-panel" inert={!open} aria-hidden={!open}>
        <div className="t-acc-panel-inner">
          <div className="guide-section-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function QuickRules({ victoryPoints = DEFAULT_VICTORY_POINTS }: { victoryPoints?: number }) {
  const [section, setSection] = useState<string | null>('build');
  const disclosure = (key: string) => ({
    open: section === key,
    onToggle: () => setSection(section === key ? null : key),
  });
  return (
    <div className="rules-book quick-guide">
      <div className="guide-goal">
        <Trophy size={30} />
        <div>
          <strong>First to {victoryPoints} points</strong>
          <span>Reach the goal on your own turn to win.</span>
        </div>
      </div>
      <GuideSection title="Your turn" icon={<Dices />} {...disclosure('turn')}>
        <ol className="guide-turn-steps">
          <li>
            <b>Roll.</b> Everyone collects from matching tiles: 1 per settlement, 2 per city. The robber
            blocks its tile.
          </li>
          <li>
            <b>Trade & build.</b> Spend resources in any order. You can trade with players, the bank or your
            ports.
          </li>
          <li>
            <b>Next.</b> Pass the dice when you’re finished.
          </li>
        </ol>
        <p>At the start, place 2 settlements and 2 roads. The game highlights each required placement.</p>
      </GuideSection>
      <GuideSection title="Build & buy" icon={<House />} {...disclosure('build')}>
        <dl className="guide-costs">
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
              <div key={kind} className="guide-recipe">
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
        <p>
          Extend roads from your network. Settlements need a connected road and an empty intersection between
          buildings. Upgrade your own settlement to a city.
        </p>
      </GuideSection>
      <GuideSection title="Points & awards" icon={<Trophy />} {...disclosure('points')}>
        <dl className="guide-points">
          <div>
            <dt>Settlement</dt>
            <dd>1 point</dd>
          </div>
          <div>
            <dt>City</dt>
            <dd>2 points total</dd>
          </div>
          <div>
            <dt>Victory Point card</dt>
            <dd>1 point</dd>
          </div>
        </dl>
        <p className="guide-award">
          <Route />
          <span>
            <b>Longest Road · +2 points</b>Longest continuous route, at least 5 roads.
          </span>
        </p>
        <p className="guide-award">
          <Shield />
          <span>
            <b>Largest Army · +2 points</b>Most Knights played, at least 3.
          </span>
        </p>
        <p>Award holders keep them through a tie. Beat their count to claim an award.</p>
      </GuideSection>
      <GuideSection title="When a 7 is rolled" icon={<Robber />} {...disclosure('robber')}>
        <p>Anyone holding over 7 resources discards half, rounded down. No tiles produce.</p>
        <p>
          The player who rolled moves the robber to another tile and steals 1 random resource from an opponent
          with a settlement or city beside it.
        </p>
      </GuideSection>
      <GuideSection title="Development cards" icon={<ScrollText />} {...disclosure('cards')}>
        <p>
          Play at most 1 per turn, starting on the turn after you buy it. You can play before rolling. Select
          a card, review it, then confirm.
        </p>
        <p>
          <b>Victory Point cards</b> count immediately and stay hidden until you win; they don’t use your
          one-card allowance.
        </p>
      </GuideSection>
      <a
        className="guide-rulebook-link"
        href="https://github.com/shashwtd/catanova/blob/main/docs/RULEBOOK.md"
        target="_blank"
        rel="noreferrer"
      >
        Full rulebook <NextTurn size={16} />
      </a>
    </div>
  );
}
