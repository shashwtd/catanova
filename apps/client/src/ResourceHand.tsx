import type { CSSProperties } from 'react';
import type { Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import { CardTooltip } from './CardTooltip.js';
import { RESOURCE_DESCRIPTION } from './cards.js';
export function ResourceHand({
  hand,
  pulse,
  reducedMotion,
  onHover,
}: {
  hand: Hand;
  pulse: Partial<Record<Resource, string>>;
  reducedMotion: boolean;
  onHover: () => void;
}) {
  return (
    <div className="resource-hand" aria-label="Your resource cards">
      {RESOURCES.map((resource, i) => (
        <div
          className="hand-slot"
          key={resource}
          style={{ '--card-angle': `${(i - 2) * 3.5}deg` } as CSSProperties}
          data-resource-card={resource}
        >
          <CardTooltip
            disabledMotion={reducedMotion || hand[resource] === 0}
            onHover={onHover}
            content={
              <>
                <ResourceIcon resource={resource} />
                <strong>{RESOURCE_NAMES[resource]}</strong>
                <span>{RESOURCE_DESCRIPTION[resource]}</span>
              </>
            }
          >
            <div
              className={`resource-card t-tilt-card resource-${resource} ${hand[resource] === 0 ? 'empty-card' : ''}`}
              aria-label={`${hand[resource]} ${RESOURCE_NAMES[resource]}`}
            >
              <div
                className={
                  pulse[resource] && !reducedMotion
                    ? 'resource-card-content card-arrival'
                    : 'resource-card-content'
                }
                key={pulse[resource] ?? resource}
              >
                <span className="card-corner">
                  <span key={hand[resource]} className="t-digit-group is-animating">
                    <span className="t-digit">{hand[resource]}</span>
                  </span>
                </span>
                <div className="card-illustration">
                  <ResourceIcon resource={resource} />
                </div>
                <span className="card-name">{RESOURCE_NAMES[resource]}</span>
                <span className="card-mark">✦</span>
              </div>
              <span className="t-tilt-glare" />
            </div>
          </CardTooltip>
        </div>
      ))}
    </div>
  );
}
