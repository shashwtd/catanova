import type { CSSProperties } from 'react';
import type { Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
/** Resource identity is carried by color and artwork; the accessible name remains available. */
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
          className={`hand-slot ${hand[resource] === 0 ? 'static-card' : ''}`}
          key={resource}
          style={{ '--card-angle': `${(i - 2) * 2}deg` } as CSSProperties}
          data-resource-card={resource}
        >
          <div
            key={pulse[resource] ?? resource}
            className={`resource-card card-finish resource-${resource} ${hand[resource] === 0 ? 'empty-card' : ''} ${pulse[resource] && !reducedMotion ? 'card-arrival' : ''}`}
            role="img"
            aria-label={`${hand[resource]} ${RESOURCE_NAMES[resource]}`}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse' && hand[resource] > 0) onHover();
            }}
          >
            <div className="resource-card-content">
              <span className="card-corner">
                <span key={hand[resource]} className="t-digit-group is-animating">
                  <span className="t-digit">{hand[resource]}</span>
                </span>
              </span>
              <div className="card-illustration">
                <ResourceIcon resource={resource} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
