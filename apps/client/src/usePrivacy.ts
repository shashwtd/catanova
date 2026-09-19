/**
 * What this player lets their friends see.
 *
 * It is one switch, but it has to live on the server rather than in this
 * browser: it governs what *other people* are told, so a copy kept locally
 * would be a preference that only claims to be a privacy setting. A guest, or
 * a server without accounts, has nobody to share with, so the hook reports
 * that there is nothing here to set and the switch stays inert.
 */
import { useCallback, useEffect, useState } from 'react';
import { accountApi } from './account-api.js';
import type { AccountPrivacy } from '../../../packages/protocol/src/player-hub.js';

export function useAccountPrivacy(accessToken: () => Promise<string | undefined>, enabled: boolean) {
  const [value, setValue] = useState<AccountPrivacy | null>(null);
  useEffect(() => {
    if (!enabled) {
      setValue(null);
      return;
    }
    const controller = new AbortController();
    let live = true;
    void (async () => {
      try {
        const next = await accountApi.privacy(await accessToken(), controller.signal);
        if (live) setValue(next);
      } catch {
        /* A panel that cannot read the setting stays inert rather than guessing at it. */
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
    // `accessToken` is a stable callback from useAuth; re-reading on every render would loop.
  }, [enabled]);
  const save = useCallback(
    async (next: AccountPrivacy) => {
      // Show the new position at once and put the old one back if the save fails,
      // so the switch is never left claiming something the server disagrees with.
      const previous = value;
      setValue(next);
      try {
        setValue(await accountApi.savePrivacy(await accessToken(), next));
      } catch (error) {
        setValue(previous);
        throw error;
      }
    },
    [accessToken, value],
  );
  return { value, save: enabled ? save : undefined };
}
