import type { BrowserProfile } from '../types';
import { getBinding } from './binding';

let cachedProfiles: BrowserProfile[] | undefined;

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
