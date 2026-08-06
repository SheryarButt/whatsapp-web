import { DEFAULT_ALERTS, type AlertSettings } from '../shared/types'

/**
 * Priority-alert matching.
 *
 * The same algorithm runs in two places: here (for validation and tests) and
 * inside the page's main world, where it has to decide *synchronously* whether
 * to suppress WhatsApp's own notification. Keep the two in step — the main-world
 * copy lives in src/preload/account.ts.
 */

/** Trim, drop blanks, lowercase, de-duplicate. */
export function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const word = item.trim().toLowerCase()
    if (word.length > 0 && word.length <= 100) seen.add(word)
  }
  return [...seen].slice(0, 200)
}

export function sanitizeAlerts(raw: unknown): AlertSettings {
  const r = (raw ?? {}) as Partial<AlertSettings>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_ALERTS.enabled,
    keywords: normalizeKeywords(r.keywords),
    wholeWord: typeof r.wholeWord === 'boolean' ? r.wholeWord : DEFAULT_ALERTS.wholeWord,
  }
}

/**
 * Word boundaries are done with Unicode letter/number classes rather than \b,
 * which is ASCII-only in JS: \burgent\b would not fire correctly inside
 * non-Latin text, and this app is explicitly multilingual.
 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)
}

/**
 * @returns the keyword that matched, or null. Returning the keyword (not a
 *   boolean) lets the notification say *why* it was escalated.
 */
export function matchKeyword(
  text: string,
  keywords: string[],
  wholeWord: boolean,
): string | null {
  if (keywords.length === 0) return null
  const haystack = String(text ?? '').toLowerCase()
  if (haystack.length === 0) return null

  for (const word of keywords) {
    let from = 0
    for (;;) {
      const at = haystack.indexOf(word, from)
      if (at === -1) break
      if (!wholeWord) return word
      const before = at === 0 ? undefined : haystack[at - 1]
      const after = haystack[at + word.length]
      if (!isWordChar(before) && !isWordChar(after)) return word
      from = at + 1
    }
  }
  return null
}
