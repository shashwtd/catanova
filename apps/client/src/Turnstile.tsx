import { useEffect, useRef, useState } from 'react';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileOptions {
  sitekey: string;
  action: string;
  theme: 'light';
  size: 'compact';
  appearance: 'always';
  retry: 'never';
  'refresh-expired': 'never';
  'refresh-timeout': 'never';
  'response-field': false;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  'timeout-callback': () => void;
  'unsupported-callback': () => void;
}

export interface TurnstileApi {
  ready: (callback: () => void) => void;
  render: (element: HTMLElement, options: TurnstileOptions) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

// One successful script load is shared across mounts. A failed load can be retried.
export function createTurnstileLoader(
  doc: Document,
  getApi: () => TurnstileApi | undefined,
  timeoutMs = 12_000,
) {
  let loading: Promise<TurnstileApi> | undefined;
  return () => {
    if (loading) return loading;
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      let settled = false;
      let script: HTMLScriptElement | undefined;
      const finish = (api?: TurnstileApi) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (script) {
          script.removeEventListener('load', ready);
          script.removeEventListener('error', failed);
        }
        if (api) resolve(api);
        else {
          script?.remove();
          reject(new Error('Verification could not load.'));
        }
      };
      const failed = () => finish();
      const ready = () => {
        const api = getApi();
        if (!api) return failed();
        try {
          api.ready(() => finish(api));
        } catch {
          failed();
        }
      };
      const timeout = setTimeout(failed, timeoutMs);
      if (getApi()) ready();
      else {
        script = doc.createElement('script');
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', ready);
        script.addEventListener('error', failed);
        doc.head.append(script);
      }
    }).catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
}

let browserLoader: (() => Promise<TurnstileApi>) | undefined;
function loadTurnstile() {
  browserLoader ??= createTurnstileLoader(
    document,
    () => (window as Window & { turnstile?: TurnstileApi }).turnstile,
  );
  return browserLoader();
}

type CheckState = 'loading' | 'checking' | 'verified' | 'error';
export interface TurnstileProps {
  siteKey: string;
  action: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

// Kept separate from React so late callbacks and teardown can be checked without a browser.
export function mountTurnstile(
  element: HTMLElement,
  props: TurnstileProps,
  onState: (state: CheckState) => void,
  load: () => Promise<TurnstileApi> = loadTurnstile,
) {
  let active = true;
  let failed = false;
  let api: TurnstileApi | undefined;
  let widgetId: string | undefined;
  const delivered = new Set<string>();
  const fail = () => {
    if (!active || failed) return;
    failed = true;
    props.onExpire?.();
    onState('error');
  };
  void load().then((loaded) => {
    if (!active) return;
    api = loaded;
    onState('checking');
    try {
      widgetId = api.render(element, {
        sitekey: props.siteKey,
        action: props.action,
        theme: 'light',
        size: 'compact',
        appearance: 'always',
        retry: 'never',
        'refresh-expired': 'never',
        'refresh-timeout': 'never',
        'response-field': false,
        callback: (token) => {
          if (!active || failed || !token || delivered.has(token)) return;
          delivered.add(token);
          onState('verified');
          props.onVerify(token);
        },
        'expired-callback': () => {
          if (!active || failed) return;
          props.onExpire?.();
          onState('checking');
          try {
            if (widgetId !== undefined) api?.reset(widgetId);
          } catch {
            fail();
          }
        },
        'error-callback': fail,
        'timeout-callback': fail,
        'unsupported-callback': fail,
      });
      if (widgetId === undefined) fail();
    } catch {
      fail();
    }
  }, fail);
  return () => {
    active = false;
    delivered.clear();
    if (widgetId !== undefined) {
      try {
        api?.remove(widgetId);
      } catch {
        // Teardown must still finish if the remote script has already removed its frame.
      }
    }
  };
}

export function Turnstile({ siteKey, action, onVerify, onExpire }: TurnstileProps) {
  const element = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onVerify, onExpire });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CheckState>('loading');
  callbacks.current = { onVerify, onExpire };

  useEffect(() => {
    if (!element.current) return;
    setState('loading');
    return mountTurnstile(
      element.current,
      {
        siteKey,
        action,
        onVerify: (token) => callbacks.current.onVerify(token),
        onExpire: () => callbacks.current.onExpire?.(),
      },
      setState,
    );
  }, [siteKey, action, attempt]);

  return (
    <div className="captcha-check">
      <div className="captcha-check-widget" ref={element} />
      <div className="captcha-check-status" role="status" aria-live="polite">
        {state === 'loading' && 'Loading verification…'}
        {state === 'error' && 'Verification could not finish.'}
      </div>
      {state === 'error' && (
        <button
          type="button"
          className="captcha-check-retry dark-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry verification
        </button>
      )}
    </div>
  );
}
