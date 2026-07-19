import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestEnrollmentTurnstile,
  TURNSTILE_CONTAINER_ID,
} from './turnstile';

afterEach(() => {
  document.body.replaceChildren();
  document.getElementById('hackertok-turnstile-script')?.remove();
  Reflect.deleteProperty(window, 'turnstile');
});

describe('Turnstile enrollment challenge', () => {
  it('loads the official script and executes an interaction-only widget', async () => {
    const container = document.createElement('div');
    container.id = TURNSTILE_CONTAINER_ID;
    document.body.append(container);
    let success: ((token: string) => void) | undefined;
    let renderedOptions: Record<string, unknown> | undefined;
    const api = {
      render: vi.fn((
        renderedContainer: HTMLElement,
        options: Record<string, unknown>,
      ) => {
        expect(renderedContainer).toBe(container);
        renderedOptions = options;
        success = options.callback as (token: string) => void;
        return 'widget-1';
      }),
      execute: vi.fn(() => success?.('verified-token')),
      remove: vi.fn(),
    };

    const pending = requestEnrollmentTurnstile('public-site-key');
    const script = document.getElementById(
      'hackertok-turnstile-script',
    ) as HTMLScriptElement | null;
    expect(script?.src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    );
    window.turnstile = api;
    script?.dispatchEvent(new Event('load'));

    await expect(pending).resolves.toBe('verified-token');
    await Promise.resolve();
    expect(renderedOptions).toMatchObject({
      sitekey: 'public-site-key',
      action: 'push-enrollment',
      execution: 'execute',
      appearance: 'interaction-only',
    });
    expect(api.execute).toHaveBeenCalledExactlyOnceWith('widget-1');
    expect(api.remove).toHaveBeenCalledExactlyOnceWith('widget-1');
  });
});
