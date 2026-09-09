import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  defaultProfile,
  emptyFriends,
  parseProfile,
  validUsername,
} from '../../../packages/protocol/src/profile.js';
import type { Account, Profile, UsernameAvailability } from '../../../packages/protocol/src/profile.js';
import { accountApi, AccountApiError } from './account-api.js';
import { beginGoogleSignIn, beginGuestSignIn, completeGoogleLink } from './auth-flow.js';
export type RuntimeConfig = {
  auth: { url: string; publishableKey: string } | null;
  mode: 'local' | 'authenticated';
  captcha?: { siteKey: string } | null;
};
const RETURN_KEY = 'catanova.auth.return',
  PROFILE_KEY = 'catanova.local-profile';
function localProfile(): Profile {
  try {
    return parseProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'));
  } catch {
    return defaultProfile(localStorage.getItem('catanova.name') ?? '');
  }
}
export function entryLocation() {
  if (location.pathname !== '/auth/callback') return new URL(location.href);
  const target = sessionStorage.getItem(RETURN_KEY) ?? '/';
  return new URL(
    /^\/room\/[A-Z2-9]{8}(?:\?.*)?$/.test(target) || target === '/' ? target : '/',
    location.origin,
  );
}
export function useAuth() {
  const signingIn = useRef(false);
  const client = useRef<SupabaseClient | null>(null),
    currentUser = useRef<User | null>(null);
  const mounted = useRef(true),
    version = useRef(0),
    configRef = useRef<RuntimeConfig | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null),
    [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true),
    [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState(''),
    [guestExpired, setGuestExpired] = useState(false);
  const [profile, setProfile] = useState(localProfile),
    [friends, setFriends] = useState(emptyFriends);
  const reloadProfile = useRef<() => Promise<void>>(async () => {});
  const accessToken = useCallback(async () => {
    if (!client.current) return undefined;
    const { data, error } = await client.current.auth.getSession();
    if (error || !data.session) throw new AccountApiError('AUTH_REQUIRED', 'Please sign in again');
    return data.session.access_token;
  }, []);
  const installAccount = useCallback((next: Account, expected: string) => {
    if (!mounted.current || currentUser.current?.id !== expected || next.id !== expected) return false;
    setAccount(next);
    setGuestExpired(false);
    if (next.profile) {
      setProfile(next.profile);
      localStorage.setItem('catanova.name', next.profile.name);
    }
    return true;
  }, []);
  const accountError = useCallback((e: unknown) => {
    if (!mounted.current) return;
    setError(e instanceof Error ? e.message : 'Account unavailable');
    if (e instanceof AccountApiError && e.code === 'GUEST_EXPIRED') {
      setGuestExpired(true);
      setAccount(null);
      setFriends(emptyFriends());
    }
  }, []);
  const refreshFriends = useCallback(async () => {
    const id = currentUser.current?.id;
    if (!id || currentUser.current?.is_anonymous) {
      setFriends(emptyFriends());
      return;
    }
    const next = await accountApi.friends(await accessToken());
    if (mounted.current && currentUser.current?.id === id) setFriends(next);
  }, [accessToken]);
  const saveProfile = useCallback(
    async (input: Profile) => {
      const valid = parseProfile(input);
      if (!client.current) {
        if (configRef.current?.mode !== 'local') throw new Error('Account service is not ready. Try again.');
        localStorage.setItem(PROFILE_KEY, JSON.stringify(valid));
        setProfile(valid);
        localStorage.setItem('catanova.name', valid.name);
        return valid;
      }
      const id = currentUser.current?.id;
      if (!id) throw new AccountApiError('AUTH_REQUIRED', 'Please sign in again');
      try {
        const next = await accountApi.save(await accessToken(), valid);
        if (!installAccount(next, id) || !next.profile)
          throw new Error('Your account session changed. Try again.');
        setError('');
        return next.profile;
      } catch (e) {
        if (currentUser.current?.id === id) accountError(e);
        throw e;
      }
    },
    [accessToken, installAccount, accountError],
  );
  const checkUsername = useCallback(
    async (name: string): Promise<UsernameAvailability> => {
      if (configRef.current?.mode === 'local')
        return {
          available: validUsername(name),
          ...(!validUsername(name) ? { reason: 'Use 3–20 letters, numbers or underscores' } : {}),
        };
      return accountApi.username(await accessToken(), name);
    },
    [accessToken],
  );
  const searchFriends = useCallback(
    async (query: string) => accountApi.search(await accessToken(), query),
    [accessToken],
  );
  const mutateFriend = useCallback(
    async (action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove', other: string) => {
      const id = currentUser.current?.id;
      const next = await accountApi.friendAction(await accessToken(), action, other);
      if (mounted.current && currentUser.current?.id === id) setFriends(next);
    },
    [accessToken],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true,
      unsubscribe = () => {};
    async function init() {
      const response = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not connect to Catanova');
      const config = (await response.json()) as RuntimeConfig;
      if (!active) return;
      configRef.current = config;
      setConfig(config);
      if (!config.auth) {
        setLoading(false);
        return;
      }
      const { createClient } = await import('@supabase/supabase-js');
      if (!active) return;
      const supabase = createClient(config.auth.url, config.auth.publishableKey, {
        auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
      });
      client.current = supabase;
      async function updateUser(nextUser: User | null) {
        if (!active) return;
        const request = ++version.current;
        const changed = currentUser.current?.id !== nextUser?.id;
        currentUser.current = nextUser;
        setUser(nextUser);
        if (changed || !nextUser) {
          setAccount(null);
          setFriends(emptyFriends());
          setGuestExpired(false);
        }
        if (!nextUser) return;
        try {
          const next = await accountApi.get(await accessToken());
          if (active && request === version.current) {
            if (!installAccount(next, nextUser.id))
              throw new Error('Your account session changed. Sign in again.');
            setError('');
            if (next.registered && !next.isGuest) void refreshFriends().catch(accountError);
          }
        } catch (e) {
          if (active && request === version.current) {
            setAccount(null);
            accountError(e);
          }
        }
      }
      reloadProfile.current = async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          accountError(error);
          return;
        }
        await updateUser(data.session?.user ?? null);
      };
      let result = await supabase.auth.getSession();
      if (result.error) throw result.error;
      let linkingError = '';
      if (location.pathname === '/auth/callback') {
        const callback = new URL(location.href);
        const failed =
          callback.searchParams.has('error') || new URLSearchParams(callback.hash.slice(1)).has('error');
        try {
          await completeGoogleLink(supabase, sessionStorage, result.data.session, failed);
          if (failed) linkingError = 'Google sign-in could not finish. Please try again.';
        } catch (e) {
          linkingError = e instanceof Error ? e.message : 'Google could not be linked';
        }
        // Recovery may have restored the guest session; never keep the callback's other account.
        result = await supabase.auth.getSession();
        const target = entryLocation();
        history.replaceState(null, '', target.pathname + target.search);
        sessionStorage.removeItem(RETURN_KEY);
      }
      await updateUser(result.data.session?.user ?? null);
      if (linkingError && active) setError(linkingError);
      const subscription = supabase.auth.onAuthStateChange((event, session) => {
        // Supabase holds an auth lock during callbacks: account/auth calls run after it releases.
        if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event))
          setTimeout(() => {
            if (active) void updateUser(session?.user ?? null);
          }, 0);
      });
      unsubscribe = () => subscription.data.subscription.unsubscribe();
      if (active) setLoading(false);
    }
    void init().catch((e) => {
      if (active) {
        accountError(e);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      ++version.current;
      unsubscribe();
    };
  }, [accessToken, installAccount, accountError, refreshFriends]);
  useEffect(() => {
    if (!account?.registered || account.isGuest) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshFriends().catch(() => {});
    };
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [account?.id, account?.registered, account?.isGuest, refreshFriends]);
  useEffect(() => {
    if (!account?.isGuest || !account.registered) return;
    const id = account.id;
    let last = 0,
      pending = false;
    const activity = () => {
      if (pending || Date.now() - last < 60000 || document.visibilityState !== 'visible') return;
      last = Date.now();
      pending = true;
      void accessToken()
        .then((token) => accountApi.touch(token))
        .then((next) => installAccount(next, id))
        .catch((e) => {
          if (currentUser.current?.id === id) accountError(e);
        })
        .finally(() => {
          pending = false;
        });
    };
    window.addEventListener('pointerdown', activity, { passive: true });
    window.addEventListener('keydown', activity);
    return () => {
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [account?.id, account?.isGuest, account?.registered, accessToken, installAccount, accountError]);
  async function signIn(returnPath = location.pathname) {
    if (!client.current) {
      setError('Google sign-in has not been configured on this server');
      return;
    }
    if (signingIn.current) return;
    signingIn.current = true;
    setLoading(true);
    setError('');
    sessionStorage.setItem(RETURN_KEY, /^\/room\/[A-Z2-9]{8}$/.test(returnPath) ? returnPath : '/');
    try {
      await beginGoogleSignIn(
        client.current,
        sessionStorage,
        `${location.origin}/auth/callback`,
        guestExpired,
      );
    } catch (e) {
      accountError(e);
    } finally {
      signingIn.current = false;
      setLoading(false);
    }
  }
  async function signInGuest(returnPath = location.pathname, captchaToken?: string) {
    if (!client.current) {
      setError('Guest accounts need Supabase to be configured');
      return;
    }
    if (signingIn.current) return;
    signingIn.current = true;
    setLoading(true);
    setError('');
    try {
      if (currentUser.current && !guestExpired) {
        await reloadProfile.current();
        return;
      }
      await beginGuestSignIn(
        client.current,
        !!configRef.current?.captcha?.siteKey,
        captchaToken,
        guestExpired,
      );
      // No navigation: preserve an invite room while the same screen opens onboarding.
      if (/^\/room\/[A-Z2-9]{8}$/.test(returnPath)) sessionStorage.setItem(RETURN_KEY, returnPath);
      await reloadProfile.current();
    } catch (e) {
      accountError(e);
    } finally {
      signingIn.current = false;
      setLoading(false);
    }
  }
  async function signOut() {
    if (client.current) {
      const { error } = await client.current.auth.signOut();
      if (error) {
        accountError(error);
        return false;
      }
    }
    ++version.current;
    currentUser.current = null;
    setUser(null);
    setAccount(null);
    setFriends(emptyFriends());
    setGuestExpired(false);
    setError('');
    return true;
  }
  return {
    config,
    user,
    loading,
    error,
    profile,
    account,
    friends,
    guestExpired,
    googleAvatarUrl: account?.googleAvatarUrl ?? null,
    needsOnboarding: !!user && !!account && !account.registered,
    saveProfile,
    accessToken,
    signIn,
    signInGuest,
    signOut,
    checkUsername,
    searchFriends,
    refreshFriends,
    requestFriend: (id: string) => mutateFriend('request', id),
    respondFriend: (id: string, accept: boolean) => mutateFriend(accept ? 'accept' : 'decline', id),
    cancelFriend: (id: string) => mutateFriend('cancel', id),
    removeFriend: (id: string) => mutateFriend('remove', id),
    clearError: () => setError(''),
    retryProfile: () => reloadProfile.current(),
    canPlay:
      !loading && !!config && (config.mode === 'local' || (!!user && !!account?.registered && !guestExpired)),
  };
}
