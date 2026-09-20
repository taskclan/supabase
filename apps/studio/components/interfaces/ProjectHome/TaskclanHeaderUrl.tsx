/**
 * The app's live URL in the project header, for a Taskclan Cloud app.
 *
 * Upstream's header shows a project's Supabase API URL via ProjectConnectionPopover
 * (useProjectApiUrl). On a self-hosted console that endpoint stubs to
 * `http://localhost:8000`, which is meaningless next to a deployed backend — the
 * thing a person actually wants there is where the app is reachable in
 * production. So for !IS_PLATFORM this replaces the popover with the deploy URL,
 * resolved the same way the overview cards do (custom domain, else the managed
 * host). Nothing is shown until it deploys and has a URL, rather than a stub.
 */
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, copyToClipboard } from 'ui'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import type { Overview } from '@/lib/taskclan/overview'

export const TaskclanHeaderUrl = ({ projectRef }: { projectRef?: string }) => {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!projectRef) return
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch(`/api/taskclan/${projectRef}/overview`)
        const body = res.ok ? ((await res.json()) as Overview) : null
        if (live) setUrl(body?.liveUrl ?? null)
      } catch {
        // A header URL is not worth surfacing an error for; the overview cards
        // below carry the louder version.
      }
    })()
    return () => {
      live = false
    }
  }, [projectRef])

  // No URL yet (never deployed, or no host assigned): show nothing rather than a
  // stub. The name above still stands on its own.
  if (!url) return null

  const display = url.replace(/^https?:\/\//, '')
  return (
    <div className="mt-3 flex items-center gap-2">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 max-w-[400px] items-center gap-1.5 truncate text-sm text-foreground-light hover:text-foreground"
      >
        <span className="truncate">{display}</span>
        <ExternalLink size={13} className="shrink-0" />
      </a>
      <Button
        type="button"
        size="tiny"
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        onClick={() => {
          copyToClipboard(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        Copy
      </Button>
    </div>
  )
}
