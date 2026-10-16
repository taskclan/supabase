/**
 * Turning Cloud's metered usage into something a person can read.
 *
 * Cloud bills in the units it can actually measure: vCPU seconds, gigabyte
 * seconds of memory, build seconds. Those are the right units to bill in and
 * the wrong ones to show: "6309096.27 compute_vcpu_seconds" is a number nobody
 * can hold in their head or sanity check against what they think they are
 * running.
 *
 * Kept pure and separate from the screen for the usual reason in this codebase:
 * a wrong conversion here does not throw, it renders a plausible number, and
 * the only way to catch that is to test the arithmetic on its own.
 */

/** A metered line as Cloud reports it. */
export interface UsageLine {
  metric: string
  quantity: number
  credits: number
  usd: number
}

export interface ReadableUsageLine {
  metric: string
  label: string
  /** The quantity in a unit worth reading, already formatted. */
  amount: string
  credits: number
  usd: number
}

const SECONDS_PER_HOUR = 3600

/**
 * How each metric is named and scaled.
 *
 * Only metrics Cloud actually emits appear here. An unknown one is passed
 * through with its raw name rather than hidden: a new metric showing up ugly is
 * a prompt to add it, where silently dropping it would understate a bill.
 */
const METRICS: Record<string, { label: string; format: (quantity: number) => string }> = {
  compute_vcpu_seconds: {
    label: 'Compute',
    format: (q) => `${round(q / SECONDS_PER_HOUR)} vCPU-hours`,
  },
  compute_gb_seconds: {
    label: 'Memory',
    format: (q) => `${round(q / SECONDS_PER_HOUR)} GB-hours`,
  },
  build_seconds: {
    label: 'Build time',
    format: (q) => formatDuration(q),
  },
  requests: {
    label: 'Requests',
    format: (q) => compact(q),
  },
  egress_bytes: {
    label: 'Egress',
    format: (q) => `${round(q / 1024 ** 3)} GB`,
  },
  disk_gb_seconds: {
    label: 'Disk',
    format: (q) => `${round(q / SECONDS_PER_HOUR)} GB-hours`,
  },
}

/** Two decimals at most, and no trailing zeros, so 1.00 reads as 1. */
function round(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(2)).toLocaleString('en-US')
}

/** Thousands separators, and k/M past the point where digits stop being read. */
function compact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 10_000) return `${Number((value / 1_000).toFixed(1))}k`
  return Math.round(value).toLocaleString('en-US')
}

/** Build time in the largest unit that leaves a number worth reading. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 minutes'
  if (seconds < 60) return `${Math.round(seconds)} seconds`
  if (seconds < SECONDS_PER_HOUR) {
    const minutes = Math.round(seconds / 60)
    return minutes === 1 ? '1 minute' : `${minutes} minutes`
  }
  const hours = Number((seconds / SECONDS_PER_HOUR).toFixed(1))
  return hours === 1 ? '1 hour' : `${hours.toLocaleString('en-US')} hours`
}

/** Credits are whole units; the USD value is what people recognise. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00'
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatCredits(credits: number): string {
  if (!Number.isFinite(credits)) return '0'
  return Math.round(credits).toLocaleString('en-US')
}

/** One metered line, ready to render. */
export function readableLine(line: UsageLine): ReadableUsageLine {
  const known = METRICS[line.metric]
  return {
    metric: line.metric,
    label: known?.label ?? line.metric,
    amount: known ? known.format(line.quantity) : compact(line.quantity),
    credits: line.credits,
    usd: line.usd,
  }
}

/**
 * Every line, largest spend first.
 *
 * Ordered by cost rather than by name because the question this screen answers
 * is "what is my money going on", and the answer should be the first row.
 */
export function readableUsage(lines: UsageLine[]): ReadableUsageLine[] {
  return [...lines].sort((a, b) => b.usd - a.usd).map(readableLine)
}
