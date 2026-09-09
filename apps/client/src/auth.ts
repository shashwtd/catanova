import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { defaultProfile, parseProfile } from '../../../packages/protocol/src/profile.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
export type RuntimeConfig = {
  auth: { url: string; publishableKey: string } | null;
  mode: 'local' | 'authenticated';
};
const RETURN_KEY = 'catanova.auth.return';
const PROFILE_KEY = 'catanova.local-profile';
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
  return new URL(target.startsWith('/room/') || target === '/' ? target : '/', location.origin);
}
export function useAuth() {
  const client = useRef<SupabaseClient | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null),
    [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true),
    [profileReady, setProfileReady] = useState(false),
    [error, setError] = useState(''),
    [profile, setProfile] = useState(localProfile);
  const reloadProfile = useRef<() => Promise<void>>(async () => {});
  const accessToken = useCallback(async () => {
    if (!client.current) return undefined;
    const { data, error } = await client.current.auth.getSession();
    if (error || !data.session) throw new Error('Please sign in again');
    return data.session.access_token;
  }, []);
  const saveProfile = useCallback(
    async (input: Profile) => {
      const valid = parseProfile(input);
      if (client.current) {
        const token = await accessToken();
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(valid),
        });
        if (!response.ok) throw new Error(((await response.json()) as { error: string }).error);
      } else localStorage.setItem(PROFILE_KEY, JSON.stringify(valid));
      setProfile(valid);
      localStorage.setItem('catanova.name', valid.name);
      return valid;
    },
    [accessToken],
  );
  useEffect(() => {
    let active = true,
      unsubscribe = () => {};
    async function init() {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Could not connect to Catanova');
      const config = (await response.json()) as RuntimeConfig;
      if (!active) return;
      setConfig(config);
      if (!config.auth) {
        setLoading(false);
        return;
      }
      const supabase = createClient(config.auth.url, config.auth.publishableKey, {
        auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
      });
      client.current = supabase;
      let generation = 0;
      async function updateUser(user: User | null) {
        if (!active) return;
        const request = ++generation;
        setProfileReady(false);
        setUser(user);
        if (user) {
          try {
            const token = await accessToken();
            const response = await fetch('/api/profile', {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) throw new Error('Could not load your profile');
            const profile = parseProfile(await response.json());
            if (active && request === generation) {
              setProfile(profile);
              setProfileReady(true);
              setError('');
            }
          } catch (e) {
            if (active && request === generation)
              setError(e instanceof Error ? e.message : 'Profile unavailable');
          }
        }
      }
      reloadProfile.current = async () => {
        const { data } = await supabase.auth.getSession();
        await updateUser(data.session?.user ?? null);
      };
      const result = await supabase.auth.getSession();
      if (result.error) throw result.error;
      await updateUser(result.data.session?.user ?? null);
      if (location.pathname === '/auth/callback' && result.data.session) {
        const target = entryLocation();
        history.replaceState(null, '', target.pathname + target.search);
        sessionStorage.removeItem(RETURN_KEY);
      }
      const subscription = supabase.auth.onAuthStateChange((event, session) => {
        // Do not call another auth method while the Supabase auth callback lock is held.
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED')
          setTimeout(() => {
            void updateUser(session?.user ?? null);
          }, 0);
      });
      unsubscribe = () => subscription.data.subscription.unsubscribe();
      if (active) setLoading(false);
    }
    void init().catch((e) => {
      if (active) {
        setError(e instanceof Error ? e.message : 'Sign-in unavailable');
        setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accessToken]);
  async function signIn(returnPath = location.pathname) {
    if (!client.current) {
      setError('Google sign-in has not been configured on this server');
      return;
    }
    setError('');
    sessionStorage.setItem(RETURN_KEY, /^\/room\/[A-Z2-9]{8}$/.test(returnPath) ? returnPath : '/');
    const { error } = await client.current.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
    });
    if (error) setError(error.message);
  }
  async function signOut() {
    if (client.current) {
      const { error } = await client.current.auth.signOut();
      if (error) {
        setError(error.message);
        return false;
      }
    }
    setUser(null);
    setProfileReady(false);
    return true;
  }
  return {
    config,
    user,
    loading,
    error,
    profile,
    saveProfile,
    accessToken,
    signIn,
    signOut,
    clearError: () => setError(''),
    retryProfile: () => reloadProfile.current(),
    canPlay: !loading && !!config && (config.mode === 'local' || (!!user && profileReady)),
  };
}
