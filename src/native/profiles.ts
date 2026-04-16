import type { BrowserProfile } from '../types';
import { getBinding } from './binding';

let cachedProfiles: BrowserProfile[] | undefined;

/** Returns the list of browser profiles supported by the native transport. */
export function getProfiles(): BrowserProfile[] {
  cachedProfiles ??= getBinding().getProfiles() as BrowserProfile[];

  return cachedProfiles;
}

export function validateBrowserProfile(browser?: BrowserProfile): void {
  if (!browser) {
    return;
  }

  if (!getProfiles().includes(browser)) {
    throw new Error(`Invalid browser profile: ${browser}`);
  }
}
