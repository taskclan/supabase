/**
 * Approve a `taskclan login` from a signed-in browser.
 *
 * The CLI prints a short code and opens this page. Approving mints a Cloud API
 * key for that machine, scoped to the organisation the user has active — so
 * this one click hands a laptop long-lived access to an org's apps, secrets and
 * deploys. The screen is built around saying that plainly before the click,
 * not after.
 *
 * Three things it refuses to do, each because the alternative misleads:
 *
 * It never auto-approves from the URL. `?code=` is prefilled because retyping a
 * code is miserable, but a link that grants access on load is a link that can be
 * sent to someone. The confirm stays a deliberate act.
 *
 * It names the organisation, because the engine binds the key to the caller's
 * *active* org rather than to anything in the request. Somebody with two orgs
 * would otherwise have no way to know which one they just opened up.
 *
 * It does not report success on a timeout. The CLI polls, so a screen claiming
 * approval that never landed leaves someone watching a terminal forever.
 *
 * Ported from the engine console's /cloud/device rather than rebuilt blind: same
 * flow, same endpoints, this console's components and per-user auth.
 */
import { useParams } from 'common'
import { Check, MonitorSmartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Input } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'

import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface PendingDevice {
  found: boolean
  userCode?: string
  label?: string | null
  org?: { id: string; name: string }
  canApprove?: boolean
  error?: string
}

export const TaskclanDeviceApproval = () => {
  const params = useParams()
  const initialCode = typeof params.code === 'string' ? params.code : ''

  const [code, setCode] = useState(initialCode)
  const [pending, setPending] = useState<PendingDevice | null>(null)
  const [isLooking, setIsLooking] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [approvedOrg, setApprovedOrg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const look = async (value: string) => {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      setPending(null)
      return
    }
    setIsLooking(true)
    setError(null)
    try {
      const res = await taskclanFetch(`/api/taskclan/device?code=${encodeURIComponent(trimmed)}`)
      const body = (await res.json().catch(() => ({}))) as PendingDevice
      if (!res.ok) {
        setError(body?.error || `Could not look up that code (${res.status})`)
        setPending(null)
        return
      }
      setPending(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(null)
    } finally {
      setIsLooking(false)
    }
  }

  // Look up the prefilled code once, so somebody arriving from the CLI sees
  // what they are approving without another click. Looking is a read; the
  // approval itself stays deliberate.
  useEffect(() => {
    if (initialCode) void look(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  const handleApprove = async () => {
    setIsApproving(true)
    setError(null)
    try {
      const res = await taskclanFetch('/api/taskclan/device', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The engine's own words: an expired code, a role without deploy
        // rights. Both tell somebody what to do next; "approval failed" does not.
        setError(body?.error || `Could not approve this device (${res.status})`)
        return
      }
      setApprovedOrg(body?.org?.name ?? pending?.org?.name ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsApproving(false)
    }
  }

  if (approvedOrg !== null) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <Check size={22} className="text-brand" />
        <h1 className="text-lg text-foreground">Device approved</h1>
        <p className="text-sm text-foreground-light">
          It now has access to <span className="text-foreground">{approvedOrg}</span>. Return to
          your terminal, which finishes signing in on its own within a few seconds.
        </p>
        <p className="text-xs text-foreground-lighter">
          You can revoke this machine at any time from the organization&rsquo;s API Keys page.
        </p>
      </div>
    )
  }

  const canApprove = !!pending?.found && pending.canApprove !== false && !isApproving

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg text-foreground">Approve a device</h1>
        <p className="text-sm text-foreground-light">
          Enter the code shown in your terminal by <span className="font-mono">taskclan login</span>
          .
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="tc-device-code" className="text-sm text-foreground">
            Code
          </label>
          <Input
            id="tc-device-code"
            autoFocus={!initialCode}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => void look(code)}
            placeholder="ABCD-1234"
          />
        </div>
        <Button
          variant="default"
          onClick={() => void look(code)}
          loading={isLooking}
          disabled={code.trim().length === 0 || isLooking}
        >
          Look up
        </Button>
      </div>

      {error && <Admonition type="warning" title="Could not approve" description={error} />}

      {pending !== null && !pending.found && !isLooking && (
        <Admonition
          type="default"
          title="No pending request for that code"
          description="Codes expire a few minutes after taskclan login prints them. Run it again to get a new one."
        />
      )}

      {pending?.found && (
        <div className="flex flex-col gap-4 rounded border border-border p-4">
          <div className="flex items-start gap-3">
            <MonitorSmartphone size={18} className="mt-0.5 text-foreground-light" />
            <div className="flex flex-col gap-1">
              <p className="text-sm text-foreground">
                {pending.label || 'An unnamed machine'} is asking to sign in
              </p>
              <p className="font-mono text-xs text-foreground-lighter">{pending.userCode}</p>
            </div>
          </div>

          {/* The organisation is the consequence, so it is stated rather than
              implied. The engine binds the key to the caller's active org, not
              to anything in the request. */}
          <Admonition
            type="warning"
            title={`This grants access to ${pending.org?.name ?? 'your organization'}`}
            description="The machine gets a long-lived key that can deploy, read environment variables and spend credits in this organization. Only approve a device you are sitting at."
          />

          {pending.canApprove === false && (
            <Admonition
              type="default"
              title="Your role cannot approve devices"
              description="Ask an owner or admin of this organization to approve it instead."
            />
          )}

          <div>
            <Button onClick={handleApprove} loading={isApproving} disabled={!canApprove}>
              Approve this device
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
