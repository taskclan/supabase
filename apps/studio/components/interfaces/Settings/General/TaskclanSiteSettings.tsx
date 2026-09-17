/**
 * What this app *is*, and how to destroy it.
 *
 * Upstream's General settings are built for a Supabase project: compliance
 * mode, service versions, project transfer, custom domains through Supabase's
 * own API. None of that is served by this build, so on Taskclan Cloud the page
 * showed a name field and nothing else — no way to see the app's host, and no
 * way to delete it. Deleting was only possible from the engine console, which
 * is the thing this replaces.
 *
 * Identity is read-only on purpose rather than for lack of effort: the engine's
 * `sites/[id]` is GET and DELETE only. There is no rename endpoint, so a name
 * field here would either silently discard the edit or need one inventing
 * upstream first.
 */
import { useParams } from 'common'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import Panel from '@/components/ui/Panel'
import { TextConfirmModal } from '@/components/ui/TextConfirmModalWrapper'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface Site {
  id: string
  name: string
  subdomain: string | null
  host: string | null
  customDomain: string | null
  status: string | null
  type: string | null
  region: string | null
  createdAt: string | null
  liveUrl: string | null
}

/** A dash is the honest rendering of a field the engine does not send. */
const show = (v: string | null | undefined) => (v && v.length > 0 ? v : '—')

const formatCreated = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <span className="text-sm text-foreground-light">{label}</span>
    <span className="text-sm text-foreground text-right">{children}</span>
  </div>
)

export const TaskclanSiteSettings = () => {
  const router = useRouter()
  const { ref } = useParams()

  const [site, setSite] = useState<Site | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!ref) return
    let isCurrent = true
    setIsLoading(true)
    taskclanFetch(`/api/taskclan/${ref}/site`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!isCurrent) return
        if (!r.ok) {
          setLoadError(body?.error || `Could not load this app (${r.status})`)
          setSite(null)
        } else {
          setSite(body.site as Site)
          setLoadError(null)
        }
        setIsLoading(false)
      })
      .catch((e) => {
        if (!isCurrent) return
        setLoadError(e instanceof Error ? e.message : String(e))
        setIsLoading(false)
      })
    return () => {
      isCurrent = false
    }
  }, [ref])

  const handleDelete = async () => {
    if (!site) return
    setIsDeleting(true)
    try {
      const res = await taskclanFetch(`/api/taskclan/${ref}/site`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The engine explains its refusals in a sentence. Showing that beats
        // "delete failed", which leaves someone retrying something that cannot
        // succeed.
        toast.error(body?.error || `Could not delete this app (${res.status})`)
        setIsDeleting(false)
        return
      }
      toast.success(`${site.name} has been deleted`)
      setIsConfirmOpen(false)
      router.push('/organizations')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <Panel title={<h5>App</h5>}>
        <Panel.Content>
          <p className="text-sm text-foreground-light">Loading…</p>
        </Panel.Content>
      </Panel>
    )
  }

  if (loadError || !site) {
    return (
      <Panel title={<h5>App</h5>}>
        <Panel.Content>
          <Admonition
            type="warning"
            title="Could not load this app"
            description={loadError ?? 'The app could not be found.'}
          />
        </Panel.Content>
      </Panel>
    )
  }

  // Link to the full URL, but show the host. The scheme carries no information
  // here (everything is https) and it pushes the part that identifies the app
  // further from the eye.
  const liveUrl = site.liveUrl ?? site.host
  const href = liveUrl?.startsWith('http') ? liveUrl : liveUrl ? `https://${liveUrl}` : null
  const liveHost = liveUrl?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? null

  return (
    <>
      <Panel title={<h5>App</h5>}>
        <Panel.Content className="divide-y divide-border">
          <Row label="Name">{site.name}</Row>
          <Row label="Subdomain">
            <span className="font-mono text-xs">{show(site.subdomain)}</span>
          </Row>
          <Row label="URL">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground hover:underline"
              >
                {liveHost}
                <ExternalLink size={12} />
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Custom domain">
            <span className="font-mono text-xs">{show(site.customDomain)}</span>
          </Row>
          <Row label="Type">{show(site.type)}</Row>
          <Row label="Region">{show(site.region)}</Row>
          <Row label="Status">{show(site.status)}</Row>
          <Row label="Created">{formatCreated(site.createdAt)}</Row>
        </Panel.Content>
      </Panel>

      <Panel title={<h5 className="text-destructive-600">Delete this app</h5>}>
        <Panel.Content className="flex items-center justify-between gap-6">
          <p className="text-sm text-foreground-light">
            The container, its deployments and its subdomain are removed. This cannot be undone.
          </p>
          <Button variant="danger" onClick={() => setIsConfirmOpen(true)}>
            Delete app
          </Button>
        </Panel.Content>
      </Panel>

      <TextConfirmModal
        visible={isConfirmOpen}
        loading={isDeleting}
        variant="destructive"
        title={`Confirm deletion of ${site.name}`}
        alert={{
          title: 'This action cannot be undone.',
          description:
            'The app stops serving immediately. Its container, deployment history and subdomain are released, and the subdomain becomes available for anyone to claim.',
        }}
        confirmPlaceholder="Type the app name in here"
        confirmString={site.name}
        confirmLabel="I understand, delete this app"
        onConfirm={handleDelete}
        onCancel={() => {
          if (!isDeleting) setIsConfirmOpen(false)
        }}
      />
    </>
  )
}
