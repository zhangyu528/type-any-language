/**
 * Landing — localStorage helpers used by both landing and dashboard
 * (see dashboard/LibPicker.tsx). The page itself composes its data
 * off the live `getContentCatalog()` API call, so no static fallback
 * data lives here anymore.
 */

/**
 * The most recently picked lib (from `prefs.libId` in localStorage).
 * Returns `null` if unset / private mode throws.
 *
 * Used by:
 *   - dashboard/LibPicker.tsx → "继续上次" affordance
 */
export function readRecentLibId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem('prefs.libId');
  } catch {
    return null;
  }
}