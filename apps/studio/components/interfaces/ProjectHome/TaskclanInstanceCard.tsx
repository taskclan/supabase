/**
 * The container an app runs on — the honest per-app equivalent of Supabase's
 * "Primary Database" instance card.
 *
 * Supabase's card describes the project's Postgres instance (region, size,
 * connections). A Taskclan app is a container that shares one database with
 * every other app, so showing that database's stats here would report the same
 * numbers on all 22 apps and imply each owns it. What this app actually owns is
 * its container: a region, a compute allocation and live CPU. That is what this
 * shows.
 */
import { useParams } from 'common'
import { Boxes, Cpu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ShimmeringLoader } from 'ui-patterns/ShimmeringLoader'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface Instance {
  region: string
  vcpu: number | null
  memoryMib: number | null
  disk: string | null
  cpuPct: number | null
  active: number
  healthy: number
}

const mem = (mib: number | null) =>
  mib == null
    ? '—'
    : mib >= 1024
      ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB`
      : `${mib} MiB`

export const TaskclanInstanceCard = () => {
  const { ref } = useParams()
  const [inst, setInst] = useState<Instance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!ref) return
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch(`/api/taskclan/${ref}/metrics?range=24h`)
        const body = await res.json()
        if (!live) return
        if (!res.ok || !body.instance) setError(true)
        else setInst(body.instance as Instance)
      } catch {
        if (live) setError(true)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [ref])

  if (error) return null
  if (loading || !inst) return <ShimmeringLoader className="h-[92px] w-full" />

  const compute =
    inst.vcpu != null
      ? `${inst.vcpu} vCPU · ${mem(inst.memoryMib)}${inst.disk ? ` · ${inst.disk}` : ''}`
      : '—'

  return (
    <div className="rounded-md border border-default bg-surface-100">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-md bg-brand/15 text-brand">
          <Boxes size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Container</p>
          <p className="text-sm text-foreground-light">{compute}</p>
          <p className="text-xs text-foreground-lighter">{inst.region}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-default px-5 py-2.5 text-sm">
        <span className="flex items-center gap-1.5 text-foreground-light">
          <Cpu size={13} className="text-foreground-lighter" />
          CPU{' '}
          <span className="text-foreground">
            {inst.cpuPct != null ? `${inst.cpuPct.toFixed(inst.cpuPct < 1 ? 2 : 0)}%` : '—'}
          </span>
        </span>
        {/* Zero running instances is the normal idle state, not a fault: a
            Taskclan container sleeps when unused and wakes on the next request
            (that is what per-second billing buys). "Instances 0" next to a
            "Healthy" status read as broken, so idle says so in words. */}
        {inst.active === 0 ? (
          <span className="text-foreground-light">
            <span className="text-foreground">Asleep</span> · wakes on request
          </span>
        ) : (
          <span className="text-foreground-light">
            {/* Just the running count. The engine's `healthy` counter is not
                reliably populated for containers — forge3d serves 6k requests
                at 100% success and still reports 0 healthy — so a "(0 healthy)"
                note read as a fault on a working app. Overall health already
                has its own card. */}
            Instances <span className="text-foreground">{inst.active} running</span>
          </span>
        )}
      </div>
    </div>
  )
}
