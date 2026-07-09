/**
 * Reads the stored theme preference from the provided Storage object and
 * returns the resolved theme value.
 *
 * Returns `'dark'` only when the stored value is exactly the string `'dark'`.
 * All other cases — missing key, any other value, null storage, or a
 * SecurityError thrown by private-browsing mode — resolve to `'light'`.
 *
 * This is a pure function with no side-effects; it does not touch
 * `document.documentElement`. Callers are responsible for applying the
 * returned class to the HTML element.
 *
 * @param storage - A `Storage` instance (typically `localStorage`) or `null`
 *                  when storage is unavailable (e.g., SSR or test stubs).
 * @returns `'dark'` | `'light'`
 */
export function initTheme(storage: Storage | null): 'light' | 'dark' {
  try {
    const saved = storage?.getItem('m88-theme') ?? null;
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    // SecurityError in private/incognito mode — fall back to light
    return 'light';
  }
}
