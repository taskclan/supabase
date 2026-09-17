/**
 * Container sizing for the create form, and the rules the engine applies to
 * whatever the form sends it.
 *
 * Everything here is pure so it can be tested without a network. The values it
 * shapes come from `GET /api/cloud/v1/instances`; the clamping mirrors what
 * `POST /sites/[id]/deploy-service` does server-side.
 *
 * Mirroring the clamp matters more than it looks. The engine *silently rewrites*
 * an out-of-range instance count rather than rejecting it:
 *
 *   maxInstances = autoscale ? min(CEILING, max(2, requested)) : 1
 *
 * so a form that lets someone ask for 50 instances and then reports success has
 * told them something untrue. Clamping here means the number on screen is the
 * number that gets provisioned.
 *
 * The plan ceiling is a separate, stricter limit: `autoscale.max` is the
 * caller's entitlement and the engine rejects anything above it outright
 * (`computeEntitlementError`). So the usable range is [2, min(max, ceiling)].
 */

/** One pickable container size, as `GET /instances` returns it. */
export interface InstanceType {
  id: string
  label: string
  vcpu: string
  memory: string
  disk: string
  hourlyUsd: number
  monthlyUsd: number
  minPlan: string
  /** True when the caller's plan cannot provision this size. */
  locked: boolean
}

/** The caller's autoscaling entitlement. */
export interface AutoscaleInfo {
  allowed: boolean
  minPlan: string
  min: number
  /** The caller's plan limit. The engine rejects above this. */
  max: number
  /** The hard platform limit, regardless of plan. */
  ceiling: number
  default: number
  suggested: number
}

export interface InstanceCatalog {
  plan: string
  types: InstanceType[]
  default: string
  scalesToZero: boolean
  cpuNote: string
  autoscale: AutoscaleInfo
}

/** The shape `GET /sites/check?name=` returns. */
export interface NameCheck {
  valid: boolean
  available: boolean
  subdomain: string
  host: string
  reason?: string
}

/**
 * Money, formatted exactly as the engine console formats it.
 *
 * Deliberately duplicated rather than approximated: both consoles are live
 * against the same price list during the swap, and a size that reads $0.007/hr
 * in one and $0.01/hr in the other looks like a pricing bug to the customer.
 */
export const formatHourly = (n: number): string => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`
export const formatMonthly = (n: number): string =>
  `$${n < 10 ? n.toFixed(2) : Math.round(n).toString()}`

/**
 * The instance count the engine will actually provision for this request.
 *
 * Autoscale off is always exactly one instance, which is the engine's own rule
 * and not a default we chose.
 */
export function clampMaxInstances(
  requested: number,
  autoscale: boolean,
  info: Pick<AutoscaleInfo, 'max' | 'ceiling'>
): number {
  if (!autoscale) return 1
  // The plan limit and the platform limit are different numbers and either can
  // be the binding one, so take the tighter.
  const upper = Math.max(2, Math.min(info.max, info.ceiling))
  if (!Number.isInteger(requested)) return Math.min(3, upper)
  return Math.min(upper, Math.max(2, requested))
}

/**
 * Which size to select when the form first loads: the catalogue's own default
 * if the caller's plan can provision it, otherwise the largest one they can.
 *
 * Falling back to the largest unlocked rather than the smallest because the
 * default already encodes "what most apps need", so when a plan caps below it
 * the nearest honest answer is the cap, not the floor.
 */
export function defaultInstanceId(catalog: Pick<InstanceCatalog, 'types' | 'default'>): string {
  const preferred = catalog.types.find((t) => t.id === catalog.default)
  if (preferred && !preferred.locked) return preferred.id
  const unlocked = catalog.types.filter((t) => !t.locked)
  if (unlocked.length === 0) return catalog.types[0]?.id ?? ''
  return unlocked[unlocked.length - 1].id
}

/** How a size reads in the picker. */
export function describeInstance(t: InstanceType): string {
  const base = `${t.label} · ${t.memory} · ${t.vcpu} · from ${formatHourly(t.hourlyUsd)}/hr`
  return t.locked ? `${base} · ${capitalise(t.minPlan)}+` : base
}

/** The running-cost line under the picker. */
export function describeCost(t: InstanceType, scalesToZero: boolean): string {
  const parts = [
    `from ${formatHourly(t.hourlyUsd)}/hr while running (+ CPU on actual use)`,
    `up to ~${formatMonthly(t.monthlyUsd)}/mo if always on`,
  ]
  if (scalesToZero) parts.push('scales to zero when idle')
  return parts.join(' · ')
}

export type AvailabilityTone = 'idle' | 'checking' | 'ok' | 'error'

/**
 * Turn a name check into something worth reading.
 *
 * The engine distinguishes "this cannot be a subdomain" from "somebody already
 * has it", and those need different actions from the user, so they get
 * different sentences rather than one generic failure.
 */
export function availabilityMessage(
  check: NameCheck | null,
  opts: { checking?: boolean; typed?: boolean } = {}
): { tone: AvailabilityTone; text: string } {
  if (opts.checking) return { tone: 'checking', text: 'Checking availability…' }
  if (!check || !opts.typed) return { tone: 'idle', text: '' }

  if (!check.valid) {
    if (check.reason === 'reserved') {
      return { tone: 'error', text: `${check.subdomain} is reserved. Pick another name.` }
    }
    return {
      tone: 'error',
      text: 'Use letters, numbers and hyphens. The name becomes the subdomain.',
    }
  }
  if (!check.available) {
    return { tone: 'error', text: `${check.host} is taken. Pick another name.` }
  }
  return { tone: 'ok', text: `${check.host} is available` }
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
