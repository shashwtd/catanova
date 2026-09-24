/**
 * A hint, kept in a cookie, that this browser opens the player's home.
 *
 * A signed-in player who opens catanova.io used to see the landing page for a
 * moment while the app checked the session, and only then move to /play. The
 * app now sets this cookie once the player's home is /play, and clears it when
 * it is not, so the server can send "/" straight to /play before any page is
 * drawn. Nobody else pays for it: without the cookie, "/" is the landing page
 * exactly as before.
 *
 * It holds no identity and proves nothing. /play still checks the real session,
 * and a browser whose session has gone is shown the landing page and loses the
 * hint.
 */
export const HOME_HINT_COOKIE = 'catanova-home';
export const HOME_HINT_VALUE = 'play';
/** Kept fresh on every visit while signed in; long enough to outlast a holiday. */
export const HOME_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

/** Whether a request's Cookie header carries the hint. */
export function hasHomeHint(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => part.trim() === `${HOME_HINT_COOKIE}=${HOME_HINT_VALUE}`);
}

/** The Set-Cookie text that keeps the hint, or clears it. */
export function homeHintCookie(atPlay: boolean, secure: boolean): string {
  const attributes = `; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
  return atPlay
    ? `${HOME_HINT_COOKIE}=${HOME_HINT_VALUE}; Max-Age=${HOME_HINT_MAX_AGE_SECONDS}${attributes}`
    : `${HOME_HINT_COOKIE}=; Max-Age=0${attributes}`;
}
