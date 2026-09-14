import type { ReactNode } from 'react';
import type { Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import { Plus } from './GameIcons.js';

export function ResourceSummary({ hand }: { hand: Hand }) {
  return (
    <span className="resource-summary">
      {RESOURCES.filter((r) => hand[r]).map((r) => (
        <span key={r} role="img" aria-label={`${hand[r]} ${RESOURCE_NAMES[r]}`} data-count={hand[r]}>
          <ResourceIcon resource={r} />
          <b>{hand[r]}</b>
        </span>
      ))}
    </span>
  );
}

/** The whole card adds one; the separate minus control removes one. No number editor. */
export function ResourcePicker({
  value,
  onChange,
  max,
  label,
  disabled = false,
  extra,
}: {
  value: Hand;
  onChange: (hand: Hand) => void;
  max?: Hand;
  label: string;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <fieldset className="card-picker" disabled={disabled}>
      <legend>{label}</legend>
      <div className="picker-cards" data-has-selection={Object.values(value).some(Boolean)}>
        {RESOURCES.map((r) => {
          const limit = max?.[r] ?? 19;
          return (
            <div key={r} className={`picker-slot resource-${r} ${value[r] ? 'has-selection' : ''}`}>
              <button
                type="button"
                className="picker-card"
                aria-pressed={value[r] > 0}
                disabled={value[r] >= limit}
                aria-label={`Add ${RESOURCE_NAMES[r]} to ${label}; ${value[r]} selected`}
                onClick={() => onChange({ ...value, [r]: value[r] + 1 })}
              >
                <ResourceIcon resource={r} />
                <span className="picker-quantity" key={value[r]}>
                  {value[r] ? (
                    <span className="t-digit-group is-animating">
                      <span className="t-digit">{value[r]}</span>
                    </span>
                  ) : (
                    <Plus size={16} />
                  )}
                </span>
              </button>
              <button
                type="button"
                className="picker-remove"
                aria-label={`Remove ${RESOURCE_NAMES[r]} from ${label}`}
                disabled={!value[r]}
                onClick={() => onChange({ ...value, [r]: Math.max(0, value[r] - 1) })}
              >
                <span aria-hidden="true">−</span>
              </button>
            </div>
          );
        })}
        {extra}
      </div>
    </fieldset>
  );
}

export function ResourceChoice({
  value,
  onChange,
  label,
  amount,
  unavailable = [],
}: {
  value: Resource | null;
  onChange: (r: Resource) => void;
  label: string;
  amount: (r: Resource) => number;
  unavailable?: Resource[];
}) {
  return (
    <fieldset className="card-picker">
      <legend>{label}</legend>
      <div className="picker-cards" data-has-selection={value !== null}>
        {RESOURCES.map((r) => (
          <button
            type="button"
            key={r}
            className={`picker-card resource-${r}`}
            aria-label={`${label} ${amount(r)} ${RESOURCE_NAMES[r]}`}
            aria-pressed={value === r}
            disabled={unavailable.includes(r)}
            onClick={() => onChange(r)}
          >
            <ResourceIcon resource={r} />
            <span className="picker-quantity">{amount(r)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
