/**
 * safeRedirectPath — validate a `?from=` query value for post-auth redirect.
 *
 * Used by /login + /signup to decide where to land after a successful
 * submit. The caller passes the raw value from useSearchParams; we
 * return a same-origin, leading-slash path or the fallback `/`.
 *
 * Why this matters: an attacker who can craft a link like
 * `/login?from=https://evil.com` would otherwise bounce a freshly
 * logged-in user straight to a phishing page that looks like ours.
 * The classic mitigation is a small allow-list of safe characters
 * + structural checks (see below).
 *
 * Reject reasons (each returns the fallback `/`):
 *   - empty / whitespace
 *   - doesn't start with '/' (relative URL)
 *   - starts with '//' (protocol-relative — `//evil.com` resolves
 *     to a cross-origin URL on the same port)
 *   - starts with '/\' (some browsers normalize to '/')
 *   - contains '://' anywhere (absolute URL like
 *     `/x/../https://evil.com` could decode back to a cross-origin
 *     URL after percent-decoding)
 *   - contains control chars (\x00-\x1f, \x7f) or newlines
 *     (header-splitting / XSS in some contexts)
 *
 * Returns the input verbatim when all checks pass — we don't
 * decode/encode because the caller passes the URL through
 * `router.replace()` which handles percent-encoding as needed.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return fallback;

  // Must be a same-origin relative path
  if (trimmed[0] !== '/') return fallback;
  // Protocol-relative //evil.com and the /\\ trick
  if (trimmed[1] === '/' || trimmed[1] === '\\') return fallback;
  // Absolute URL embedded in the path (after percent-decode some
  // browsers normalize)
  if (trimmed.includes('://')) return fallback;
  // Backslash (some browsers convert \ to / on parse)
  if (trimmed.includes('\\')) return fallback;
  // Control chars / newlines — header splitting, log injection,
  // and the standard "no whitespace in URLs" rule
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return fallback;

  return trimmed;
}