import type {
  BrowserEmulation,
  BrowserEmulationMode,
  BrowserPlatform,
  BrowserProfile,
} from '../types';
import { getBinding } from './binding';

let cachedProfiles: BrowserProfile[] | undefined;

/** Returns the list of browser profiles supported by the native transport. */
export function getProfiles(): BrowserProfile[] {
  cachedProfiles ??= getBinding().getProfiles() as BrowserProfile[];

  return cachedProfiles;
}

export interface NormalizedBrowserEmulation {
  browser?: BrowserProfile;
  browserMode?: BrowserEmulationMode;
  browserPlatform?: BrowserPlatform;
  browserHttp2?: boolean;
  browserHeaders?: boolean;
}

/** Validates and normalizes the public browser emulation selector. */
export function normalizeBrowserEmulation(browser?: BrowserEmulation): NormalizedBrowserEmulation {
  if (!browser) {
    return {};
  }

  if (typeof browser === 'string') {
    if (!getProfiles().includes(browser)) {
      throw new Error(`Invalid browser profile: ${browser}`);
    }

    return { browser, browserMode: 'fixed' };
  }

  const mode = browser.mode ?? 'fixed';

  if (mode !== 'fixed' && mode !== 'random' && mode !== 'weighted-random') {
    throw new Error(`Invalid browser emulation mode: ${String(mode)}`);
  }

  if (mode !== 'fixed' && (browser.profile || browser.platform)) {
    throw new Error(`browser.profile and browser.platform cannot be used with mode ${mode}`);
  }

  if (browser.profile && !getProfiles().includes(browser.profile)) {
    throw new Error(`Invalid browser profile: ${browser.profile}`);
  }

  return {
    browser: browser.profile,
    browserMode: mode,
    browserPlatform: browser.platform,
    browserHttp2: browser.http2,
    browserHeaders: browser.headers,
  };
}

export function validateBrowserProfile(browser?: BrowserEmulation): void {
  normalizeBrowserEmulation(browser);
}
