/**
 * Data hooks for Buy-a-domain in the console. These call the console's own
 * /platform/organizations/{slug}/domains/* routes (which proxy to the engine as
 * the signed-in user). Raw fetch rather than the generated typed client,
 * because these Taskclan routes aren't in the OpenAPI schema.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'

import { constructHeaders } from '@/data/fetchers'
import { API_URL } from '@/lib/constants'
import type { CardOnFile, DomainQuote, PurchaseResponse, RegistrantFields } from '@/lib/taskclan/buyDomain'

/** An error carrying the engine's field-level detail (e.g. which registrant fields are missing). */
export class DomainsError extends Error {
  status: number
  missing?: string[]
  constructor(message: string, status: number, missing?: string[]) {
    super(message)
    this.name = 'DomainsError'
    this.status = status
    this.missing = missing
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await constructHeaders(init?.headers)
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', ...init, headers })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; missing?: string[] }
    throw new DomainsError(b.error || `Request failed (${res.status})`, res.status, b.missing)
  }
  return body as T
}

const base = (slug: string) => `/platform/organizations/${encodeURIComponent(slug)}/domains`

export const domainKeys = {
  search: (slug?: string, q?: string) => ['taskclan-domains', slug, 'search', q] as const,
  registrant: (slug?: string) => ['taskclan-domains', slug, 'registrant'] as const,
  paymentMethods: (slug?: string) => ['taskclan-domains', slug, 'payment-methods'] as const,
}

// ---- Search -------------------------------------------------------------
export interface DomainSearchResult {
  query: string
  domains: DomainQuote[]
  note?: string
}
export function useDomainSearchQuery(slug: string | undefined, q: string, enabled: boolean) {
  return useQuery({
    queryKey: domainKeys.search(slug, q),
    queryFn: () => call<DomainSearchResult>(`${base(slug!)}/search?q=${encodeURIComponent(q)}&limit=8`),
    enabled: enabled && !!slug && q.length > 0,
    staleTime: 60_000,
    retry: false,
  })
}

// ---- Registrant ---------------------------------------------------------
export type RegistrantDraft = Partial<Record<keyof RegistrantFields, string | null>> & { complete?: boolean }
export function useRegistrantQuery(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: domainKeys.registrant(slug),
    queryFn: () => call<{ registrant: RegistrantDraft }>(`${base(slug!)}/registrant`),
    enabled: enabled && !!slug,
    retry: false,
  })
}
export function useRegistrantUpdateMutation(
  slug: string | undefined,
  options?: UseMutationOptions<{ registrant: RegistrantDraft }, DomainsError, RegistrantFields>
) {
  const qc = useQueryClient()
  return useMutation<{ registrant: RegistrantDraft }, DomainsError, RegistrantFields>({
    mutationFn: (fields) =>
      call(`${base(slug!)}/registrant`, {
        method: 'POST',
        body: JSON.stringify({ ...fields, organization: fields.organization || null, state: fields.state || null }),
      }),
    ...options,
    async onSuccess(data, vars, ctx) {
      qc.setQueryData(domainKeys.registrant(slug), data)
      await options?.onSuccess?.(data, vars, ctx)
    },
  })
}

// ---- Payment method -----------------------------------------------------
export function usePaymentMethodsQuery(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: domainKeys.paymentMethods(slug),
    queryFn: () => call<{ cards: CardOnFile[]; hasCard: boolean }>(`${base(slug!)}/payment-methods`),
    enabled: enabled && !!slug,
    retry: false,
  })
}

// ---- Buy ----------------------------------------------------------------
export function useBuyDomainMutation(
  slug: string | undefined,
  options?: UseMutationOptions<PurchaseResponse, DomainsError, { domain: string; siteId: string }>
) {
  const qc = useQueryClient()
  return useMutation<PurchaseResponse, DomainsError, { domain: string; siteId: string }>({
    mutationFn: (vars) => call(`${base(slug!)}/register`, { method: 'POST', body: JSON.stringify(vars) }),
    ...options,
    async onSuccess(data, vars, ctx) {
      // A new domain means a new custom domain on the app; let anything that
      // lists domains/apps refetch.
      await qc.invalidateQueries({ queryKey: ['projects'] })
      await options?.onSuccess?.(data, vars, ctx)
    },
  })
}

// ---- Apps (for the "connect to" picker; needs the real site id) ---------
export interface DomainApp {
  id: string
  name: string
  subdomain?: string | null
}
export function useDomainAppsQuery(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['taskclan-domains', slug, 'apps'] as const,
    queryFn: async () => {
      const body = await call<{ sites?: Array<{ id: string; name: string; subdomain?: string | null }> }>(`${base(slug!)}/apps`)
      return (body.sites ?? []).map((s) => ({ id: s.id, name: s.name, subdomain: s.subdomain ?? null }))
    },
    enabled: enabled && !!slug,
    retry: false,
  })
}
