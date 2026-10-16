import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import ConfirmationModal from 'ui-patterns/Dialogs/ConfirmationModal'

import { useOrganizationRolesV2Query } from '@/data/organization-members/organization-roles-query'
import { organizationKeys } from '@/data/organizations/keys'
import {
  useOrganizationMembersQuery,
  type OrganizationMember,
} from '@/data/organizations/organization-members-query'
import { useSelectedOrganizationQuery } from '@/hooks/misc/useSelectedOrganization'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'
import { useProfile } from '@/lib/profile'

/**
 * Hand the workspace to another member. The engine promotes them to owner and
 * demotes the current owner to admin in one step (so it's reversible), and it
 * enforces owner-only itself — this UI gates to the owner too, so non-owners
 * don't see a control that would only 403.
 */
export const TransferOwnershipPanel = () => {
  const { profile } = useProfile()
  const { data: organization } = useSelectedOrganizationQuery()
  const slug = organization?.slug

  const { data: members = [] } = useOrganizationMembersQuery({ slug })
  const { data: roles } = useOrganizationRolesV2Query({ slug })
  const queryClient = useQueryClient()

  const [selected, setSelected] = useState('')
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const roleNameOf = (member?: OrganizationMember) => {
    const roleId = member?.role_ids?.[0]
    return roles?.org_scoped_roles.find((role) => role.id === roleId)?.name
  }

  const currentMember = members.find((m) => m.gotrue_id === profile?.gotrue_id)
  const isOwner = roleNameOf(currentMember) === 'Owner'

  // Ownership can only move to an existing, accepted member who isn't you — the
  // engine rejects anyone else.
  const candidates = members.filter(
    (m) => !m.invited_at && !!m.gotrue_id && m.gotrue_id !== profile?.gotrue_id
  )
  const target = candidates.find((m) => m.gotrue_id === selected)
  const targetLabel = target?.primary_email ?? target?.username ?? 'this member'

  if (!isOwner) {
    return (
      <Admonition
        type="default"
        title="Only the workspace owner can transfer ownership"
        description="Ask the current owner if ownership needs to move."
      />
    )
  }

  const onTransfer = async () => {
    if (!slug || !selected) return
    setSubmitting(true)
    try {
      const res = await taskclanFetch('/api/taskclan/org/transfer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, toUserId: selected }),
      })
      const body = (await res.json().catch(() => ({}))) as { newOwner?: string; error?: string }
      if (!res.ok) {
        toast.error(body.error ?? 'Could not transfer ownership.')
        return
      }
      toast.success(
        `Ownership transferred to ${body.newOwner ?? targetLabel}. You are now an admin of this workspace.`
      )
      setConfirmVisible(false)
      setSelected('')
      await queryClient.invalidateQueries({ queryKey: organizationKeys.members(slug) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not transfer ownership.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <p className="text-sm text-foreground-light">
        Hand this workspace to another member. They become the owner and you stay on as an admin, so
        the move is reversible. Billing and the ability to delete the workspace move with ownership.
      </p>

      {candidates.length === 0 ? (
        <Admonition
          type="default"
          title="No one to transfer to yet"
          description="Ownership can only move to an existing member. Invite them from the Team page first."
        />
      ) : (
        <div className="flex items-center gap-x-2">
          <select
            className="rounded-md border border-strong bg-surface-200 px-3 py-2 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a member…</option>
            {candidates.map((m) => (
              <option key={m.gotrue_id} value={m.gotrue_id as string}>
                {m.primary_email ?? m.username}
              </option>
            ))}
          </select>
          <Button type="button" variant="danger" disabled={!selected} onClick={() => setConfirmVisible(true)}>
            Transfer ownership
          </Button>
        </div>
      )}

      <ConfirmationModal
        visible={confirmVisible}
        loading={submitting}
        variant="destructive"
        title="Transfer workspace ownership?"
        confirmLabel="Transfer ownership"
        alert={{
          title: `${targetLabel} will become the owner`,
          description:
            'They gain full control, including billing and deleting the workspace. You will be demoted to admin. The new owner can transfer it back.',
        }}
        onConfirm={onTransfer}
        onCancel={() => {
          if (!submitting) setConfirmVisible(false)
        }}
      />
    </div>
  )
}
