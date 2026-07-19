const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'hackertok-turnstile-script';
const LOAD_TIMEOUT_MS = 15_000;
const CHALLENGE_TIMEOUT_MS = 120_000;

export const TURNSTILE_CONTAINER_ID = 'hackertok-turnstile';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      execution: 'execute';
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
    },
  ): string | undefined;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loadPromise: Promise<TurnstileApi> | null = null;

function loadedApi(): TurnstileApi | null {
  return window.turnstile ?? null;
}

function loadTurnstile(): Promise<TurnstileApi> {
  const loaded = loadedApi();
  if (loaded) return Promise.resolve(loaded);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const created = script === null;
    const timeout = window.setTimeout(() => {
      cleanup();
      loadPromise = null;
      reject(new Error('turnstile_load_timeout'));
    }, LOAD_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
    };
    const onLoad = () => {
      const api = loadedApi();
      cleanup();
      if (api) resolve(api);
      else {
        loadPromise = null;
        reject(new Error('turnstile_unavailable'));
      }
    };
    const onError = () => {
      cleanup();
      script?.remove();
      loadPromise = null;
      reject(new Error('turnstile_unavailable'));
    };

    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
    }
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (created) document.head.append(script);
  });
  return loadPromise;
}

export async function requestEnrollmentTurnstile(
  sitekey: string,
): Promise<string> {
  if (!sitekey) throw new Error('turnstile_not_configured');
  const container = document.getElementById(TURNSTILE_CONTAINER_ID);
  if (!container) throw new Error('turnstile_container_missing');
  const turnstile = await loadTurnstile();

  return new Promise<string>((resolve, reject) => {
    const widget = { id: undefined as string | undefined };
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(undefined, new Error('turnstile_timeout')),
      CHALLENGE_TIMEOUT_MS,
    );
    const finish = (token?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const renderedId = widget.id;
      if (renderedId) {
        queueMicrotask(() => {
          try {
            turnstile.remove(renderedId);
          } catch {
            /* The widget may already have been removed during navigation. */
          }
        });
      }
      if (token) resolve(token);
      else reject(error ?? new Error('turnstile_rejected'));
    };

    try {
      widget.id = turnstile.render(container, {
        sitekey,
        action: 'push-enrollment',
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token) => finish(token),
        'error-callback': () => finish(undefined, new Error('turnstile_error')),
        'expired-callback': () => finish(undefined, new Error('turnstile_expired')),
        'timeout-callback': () => finish(undefined, new Error('turnstile_timeout')),
      });
      if (!widget.id) {
        finish(undefined, new Error('turnstile_render_failed'));
        return;
      }
      turnstile.execute(widget.id);
    } catch {
      finish(undefined, new Error('turnstile_unavailable'));
    }
  });
}
