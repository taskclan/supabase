/**
 * Custom domains: reading the engine's answer, and failing early on input it
 * would refuse anyway.
 *
 * The engine does the real work — it binds hostnames in Cloudflare, re-reads
 * certificate and DCV state on every request, and decides who may attach a
 * domain. Nothing here duplicates that. What is here is the two things a form
 * needs locally: the same normalisation the engine applies, so the hostname
 * shown back is the one that gets stored, and the same validity rule, so an
 * obvious typo is caught without a round trip.
 *
 * `isValidHostname` is a deliberate mirror of the engine's
 * `isValidCustomDomain` (`src/lib/cloud/hosting/sites.ts`), transcribed rather
 * than reinvented. It must never be *looser* than the engine's: a form that
 * accepts what the server rejects just moves the error later. It must never be
 * tighter either, or it refuses hostnames that would have worked. When the
 * engine's rule changes this one has to change with it, which is why the source
 * is named here.
 */

/** One DNS record the user has to add, with whether it has appeared yet. */
export interface DomainRecord {
  type: string
  name: string
  value: string
  ttl?: string | number | null
  /** The engine's live check: has this record resolved yet? */
  state?: 'ok' | 'missing' | 'mismatch' | 'unknown' | string
  found?: string[]
}

export interface CustomDomain {
  hostname: string
  provider?: string | null
  status?: string | null
  sslStatus?: string | null
  errors?: string[] | null
  redirectTo?: string | null
  redirectStatus?: string | null
  records?: DomainRecord[] | null
}

/**
 * The engine's normalisation, applied before its validity check: strip a
 * protocol, drop anything after the host, lowercase, trim.
 *
 * Mirrored so that what the form previews is what the engine stores. Somebody
 * pasting `https://app.example.com/dashboard` should see `app.example.com`
 * confirmed back, not be told their input is invalid.
 */
export function normalizeHostname(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

/**
 * Transcribed from the engine's `isValidCustomDomain`. Keep in step with it.
 */
export function isValidHostname(host: string): boolean {
  const h = (host || '').trim().toLowerCase()
  if (!h || h.length > 253 || h.includes('/') || h.includes(' ') || h.includes(':')) return false
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h)
}

export type DomainHealth = 'live' | 'pending' | 'failed' | 'redirect'

/**
 * What state a domain is actually in.
 *
 * `status` and `sslStatus` are separate for a reason worth preserving: a
 * hostname can be routed and still have no certificate, which is the window
 * where a browser shows a security warning rather than the app. Treating that
 * as "live" would tell someone their domain works while visitors see a warning,
 * so both have to be active before this says live.
 */
export function domainHealth(domain: CustomDomain): DomainHealth {
  if (domain.redirectTo) return 'redirect'
  if ((domain.errors?.length ?? 0) > 0) return 'failed'
  const status = (domain.status ?? '').toLowerCase()
  const ssl = (domain.sslStatus ?? '').toLowerCase()
  if (status === 'active' && ssl === 'active') return 'live'
  return 'pending'
}

/** The sentence under a domain, explaining its state in terms of what to do. */
export function domainExplanation(domain: CustomDomain): string {
  const health = domainHealth(domain)
  if (health === 'redirect') {
    return `Redirects to ${domain.redirectTo}. It does not serve this app.`
  }
  if (health === 'failed') {
    // Cloudflare's own text. It names the actual problem far better than
    // anything generic could, and it is what support would ask for.
    return (domain.errors ?? []).join(' ')
  }
  if (health === 'live') return 'Serving this app over HTTPS.'

  const outstanding = pendingRecords(domain)
  if (outstanding.length > 0) {
    return `Waiting for ${outstanding.length === 1 ? 'a DNS record' : `${outstanding.length} DNS records`} to appear. Add the records below at your DNS provider.`
  }
  // Records are in place and Cloudflare has not finished. Saying "add the
  // records" here would send someone to re-check work they have already done.
  return 'DNS is in place. Waiting for the certificate to be issued, which usually takes a few minutes.'
}

/** Records the engine has not yet seen resolve. */
export function pendingRecords(domain: CustomDomain): DomainRecord[] {
  return (domain.records ?? []).filter((r) => (r.state ?? 'unknown') !== 'ok')
}

/**
 * Why the form's submit is disabled, or null when it is fine.
 *
 * Returned as a message rather than a boolean so the reason is shown. A
 * disabled button with no explanation is the thing people file bugs about.
 */
export function hostnameError(input: string, existing: string[] = []): string | null {
  const host = normalizeHostname(input)
  if (host.length === 0) return null
  if (!isValidHostname(host)) return 'Enter a hostname like app.yourdomain.com'
  if (existing.some((e) => e.toLowerCase() === host)) return 'That domain is already attached'
  return null
}
