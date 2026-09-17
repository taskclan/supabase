/**
 * Releases waiting on a person.
 *
 * Every push to a connected repo opens a release intent per mapped app. An app
 * on manual deploy mode opens one and then waits, with no sign anywhere that it
 * is waiting — the only symptom is a merge that never shipped, which reads as a
 * broken pipeline rather than a queue. This is the screen that shows the queue
 * and lets somebody clear it.
 *
 * Built around three things that are easy to get wrong and expensive when wrong:
 *
 * The held releases come first and everything else is history. Mixing them
 * loses the only actionable rows among fifty superseded ones.
 *
 * It says why each one is held, in the engine's words. "Held for approval" with
 * no reason is what makes people distrust a gate and go round it.
 *
 * It never claims a release shipped on the strength of the intent alone.
 * Nothing moves an intent past `executing`, so the deployment is the source of
 * truth for whether the thing actually landed.
 */
import { AlertTriangle, Check, Clock, GitCommit, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import ConfirmationModal from 'ui-patterns/Dialogs/ConfirmationModal'

import Panel from '@/components/ui/Panel'
import {
  approvalsGiven,
  approversRequired,
  groupIntents,
  holdReasons,
  isDecidable,
  isExpired,
  riskBand,
  shortSha,
  statusSummary,
  type ReleaseIntent,
} from '@/lib/taskclan/releases'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface IntentsResponse {
  intents?: ReleaseIntent[]
  siteNames?: Record<string, string>
  error?: string
}

const RISK_CLASS: Record<string, string> = {
  low: 'text-foreground-lighter',
  medium: 'text-warning',
  high: 'text-destructive',
}

const ReleaseRow = ({
  intent,
  siteName,
  onDecide,
  isBusy,
}: {
  intent: ReleaseIntent
  siteName: string
  onDecide: (intent: ReleaseIntent, action: 'approve' | 'decline') => void
  isBusy: boolean
}) => {
  const holds = holdReasons(intent)
  const required = approversRequired(intent)
  const given = approvalsGiven(intent)
  const expired = isExpired(intent)
  const canDecide = isDecidable(intent) && !expired

  return (
    <div className="rounded border border-border">
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0 flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <span className="font-mono text-xs text-foreground-lighter">{intent.ref}</span>
            <span className="truncate">{siteName}</span>
          </p>
          <p className="flex items-center gap-1.5 font-mono text-xs text-foreground-light">
            <GitCommit size={12} className="shrink-0" />
            {shortSha(intent.commitSha)}
            <span className="truncate font-sans text-foreground-lighter">
              {intent.commitMessage ?? 'no commit message'}
            </span>
          </p>
          <p className="text-xs text-foreground-light">{statusSummary(intent)}</p>
          {typeof intent.riskScore === 'number' && (
            <p className={`text-xs ${RISK_CLASS[riskBand(intent.riskScore)]}`}>
              Risk {intent.riskScore.toFixed(2)}
              {(intent.riskFactors ?? []).length > 0 &&
                ` — ${(intent.riskFactors ?? []).map((f) => f.label).filter(Boolean).join('; ')}`}
            </p>
          )}
        </div>

        {canDecide && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="default"
              icon={<X size={13} />}
              disabled={isBusy}
              onClick={() => onDecide(intent, 'decline')}
            >
              Decline
            </Button>
            <Button
              icon={isBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              disabled={isBusy}
              onClick={() => onDecide(intent, 'approve')}
            >
              {required > 1 ? `Approve (${given} of ${required})` : 'Approve'}
            </Button>
          </div>
        )}
      </div>

      {holds.length > 0 && canDecide && (
        <div className="border-t border-border px-4 py-2">
          {holds.map((r) => (
            <p key={r.rule} className="text-xs text-foreground-light">
              <span className="text-foreground">{r.title}</span>
              {r.detail ? ` — ${r.detail}` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export const TaskclanReleases = () => {
  const [data, setData] = useState<IntentsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toDecline, setToDecline] = useState<ReleaseIntent | null>(null)

  const load = async () => {
    try {
      const res = await taskclanFetch('/api/taskclan/agents/intents')
      const body = (await res.json().catch(() => ({}))) as IntentsResponse
      if (!res.ok) {
        setLoadError(body?.error || `Could not load releases (${res.status})`)
        setData({ intents: [] })
        return
      }
      setData(body)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setData({ intents: [] })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const decide = async (intent: ReleaseIntent, action: 'approve' | 'decline', note?: string) => {
    setBusyId(intent.id)
    try {
      const res = await taskclanFetch(`/api/taskclan/agents/intents/${encodeURIComponent(intent.ref)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note }),
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        // The one failure that is not a refusal: the approval landed and the
        // build did not start. The engine answers 502 with
        // { ok: false, status: 'approved' } and leaves the intent approved, so
        // the grant is spent and cannot be given again. Reporting only the
        // builder's error would read as "nothing happened", and somebody would
        // sit waiting for a release that will never start on its own.
        if (body?.ok === false && body?.status === 'approved') {
          toast.error(
            `${intent.ref} was approved, but the build did not start: ${body.error ?? 'unknown reason'}. The approval has been recorded, so this needs a new deploy rather than another approval.`
          )
          await load()
          return
        }
        // Everything else is a refusal the engine worded for a person: "you
        // have already approved this intent", "there is nothing to decide", a
        // role that cannot deploy. Each says what to do next; a generic failure
        // tells them to try again forever.
        toast.error(body?.error || `Could not ${action} this release (${res.status})`)
        return
      }

      if (action === 'decline') {
        toast.success(`${intent.ref} declined`)
      } else if (body?.status === 'awaiting_approval') {
        // A second signature is still outstanding. Saying "approved" here would
        // have somebody walk away from a release that has not started.
        toast.success(
          `Approved. ${body.approvals} of ${body.required} signatures — still waiting on one more.`
        )
      } else {
        toast.success(`${intent.ref} released`)
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
      setToDecline(null)
    }
  }

  const onDecide = (intent: ReleaseIntent, action: 'approve' | 'decline') => {
    if (action === 'decline') return setToDecline(intent)
    void decide(intent, 'approve')
  }

  const names = data?.siteNames ?? {}
  const nameFor = (i: ReleaseIntent) => names[i.siteId] ?? i.siteId.slice(0, 8)
  const { waiting, active, closed } = groupIntents(data?.intents ?? [])

  return (
    <>
      <Panel title={<h5>Held for a decision</h5>}>
        <Panel.Content className="flex flex-col gap-3">
          {data === null && (
            <p className="flex items-center gap-2 text-sm text-foreground-light">
              <Loader2 className="animate-spin" size={14} /> Loading…
            </p>
          )}
          {data !== null && loadError && (
            <Admonition type="warning" title="Could not load releases" description={loadError} />
          )}
          {data !== null && !loadError && waiting.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Check size={20} className="text-brand" />
              <p className="text-sm text-foreground-light">
                Nothing is waiting. Apps set to deploy manually open a release here on every push.
              </p>
            </div>
          )}
          {waiting.map((i) => (
            <ReleaseRow
              key={i.id}
              intent={i}
              siteName={nameFor(i)}
              onDecide={onDecide}
              isBusy={busyId === i.id}
            />
          ))}
        </Panel.Content>
      </Panel>

      {active.length > 0 && (
        <Panel title={<h5>In flight</h5>}>
          <Panel.Content className="flex flex-col gap-3">
            {active.map((i) => (
              <ReleaseRow
                key={i.id}
                intent={i}
                siteName={nameFor(i)}
                onDecide={onDecide}
                isBusy={busyId === i.id}
              />
            ))}
          </Panel.Content>
        </Panel>
      )}

      <Panel title={<h5>Recent decisions</h5>}>
        <Panel.Content className="flex flex-col gap-2">
          {/* Declines and supersedes are kept rather than hidden: "why didn't
              my merge deploy?" is answered by exactly these rows. */}
          {closed.length === 0 && (
            <p className="text-sm text-foreground-light">No decisions recorded yet.</p>
          )}
          {closed.slice(0, 20).map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-4 py-1.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <span className="font-mono text-xs text-foreground-lighter">{i.ref}</span>
                  <span className="truncate">{nameFor(i)}</span>
                  <span className="font-mono text-xs text-foreground-lighter">
                    {shortSha(i.commitSha)}
                  </span>
                </p>
                <p className="flex items-center gap-1.5 text-xs text-foreground-light">
                  {i.status === 'expired' && <Clock size={11} className="shrink-0" />}
                  {i.status === 'declined' && <AlertTriangle size={11} className="shrink-0" />}
                  {statusSummary(i)}
                </p>
              </div>
            </div>
          ))}
        </Panel.Content>
      </Panel>

      <ConfirmationModal
        visible={!!toDecline}
        loading={busyId === toDecline?.id}
        variant="destructive"
        title={`Decline ${toDecline?.ref ?? 'this release'}?`}
        confirmLabel="Decline release"
        alert={{
          title: 'This commit will not deploy.',
          description:
            'The decision is recorded against the release. A later push to the same branch opens a new one, so declining does not block the app permanently.',
        }}
        onConfirm={() => {
          if (toDecline) void decide(toDecline, 'decline')
        }}
        onCancel={() => {
          if (!busyId) setToDecline(null)
        }}
      />
    </>
  )
}
