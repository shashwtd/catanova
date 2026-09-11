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
    <div className="resource-hand resource-counters" role="group" aria-label="Your resources">
      {RESOURCES.map((resource) => (
        <div className="resource-counter-anchor" key={resource} data-resource-card={resource}>
          <div
            key={pulse[resource] ?? resource}
            className="resource-counter"
            data-empty={hand[resource] === 0}
            role="img"
            aria-label={`${hand[resource]} ${RESOURCE_NAMES[resource]}`}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse' && hand[resource] > 0) onHover();
            }}
          >
            <span className="resource-counter-art" aria-hidden="true">
              <ResourceIcon resource={resource} />
            </span>
            <span
              key={`${hand[resource]}:${pulse[resource] ?? ''}`}
              className={`resource-counter-value t-digit-group ${pulse[resource] && !reducedMotion ? 'is-animating' : ''}`}
              aria-hidden="true"
            >
              <span className="t-digit">{hand[resource]}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
