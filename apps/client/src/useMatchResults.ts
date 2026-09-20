import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { resultsKey, type MatchResults } from '../../../packages/protocol/src/results.js';
import { retainedResults } from './results-presentation.js';

/** Presentation belongs to this tab. The server owns the final score and readiness. */
export function useMatchResults(room: RoomState | null, owner: string) {
  const scope = `${owner}:${room?.roomId ?? ''}`;
  const held = useRef<{ scope: string; result: MatchResults | null }>({ scope, result: null });
  const result = retainedResults(held.current.scope === scope ? held.current.result : null, room);
  useEffect(() => {
    held.current = { scope, result };
  }, [scope, result]);
  const storageKey = `catanova.results-dismissed:${scope}`;
  const [decision, setDecision] = useState<{ scope: string; dismissed: string | null } | null>(null);
  let dismissed: string | null = null;
  try {
    dismissed = sessionStorage.getItem(storageKey);
  } catch {
    /* Storage may be disabled. */
  }
  if (decision?.scope === scope) dismissed = decision.dismissed;
  const choose = (value: string | null) => {
    setDecision({ scope, dismissed: value });
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The current tab still works without persistence. */
    }
  };
  return {
    results: result,
    visible: !!result && dismissed !== resultsKey(result),
    dismiss: () => {
      if (result) choose(resultsKey(result));
    },
    open: () => choose(null),
  };
}
