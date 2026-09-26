/**
 * The plan tiers — the primary billing surface.
 *
 * The tests lean on the states that decide what a customer can do: which plan is
 * theirs (so its button is inert rather than another "Subscribe"), whether they
 * already subscribe (so the entry point is "Manage" via the portal, not a second
 * Checkout), and that Enterprise routes to sales rather than a self-serve price.
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanPlans } from './TaskclanPlans'
import { customRender } from '@/tests/lib/custom-render'

const PLANS = {
  plans: [
    { id: 'free', name: 'Free', monthlyUsd: 0, includedUsd: 5, blurb: 'Kick the tires.', maxSize: 'Lite', autoscaleMax: 0, storageDays: 7 },
    { id: 'starter', name: 'Starter', monthlyUsd: 12, includedUsd: 5, blurb: 'Ship a real app.', maxSize: 'Basic', autoscaleMax: 3, storageDays: null },
    { id: 'pro', name: 'Pro', monthlyUsd: 39, includedUsd: 18, blurb: 'Production apps.', maxSize: 'Standard', autoscaleMax: 10, storageDays: null },
    { id: 'scale', name: 'Scale', monthlyUsd: 129, includedUsd: 60, blurb: 'Top sizes.', maxSize: 'Performance', autoscaleMax: 25, storageDays: null },
    { id: 'enterprise', name: 'Enterprise', monthlyUsd: null, includedUsd: 0, blurb: 'Custom limits.', maxSize: 'Performance', autoscaleMax: 25, storageDays: null },
  ],
}

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TaskclanPlans', () => {
  it('renders the paid tiers with their monthly price', async () => {
    vi.stubGlobal('fetch', respond(PLANS))

    customRender(<TaskclanPlans currentPlan="free" />)

    expect(await screen.findByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('$39.00')).toBeInTheDocument()
  })

  it('marks the current plan and makes its button inert', async () => {
    vi.stubGlobal('fetch', respond(PLANS))

    customRender(<TaskclanPlans currentPlan="pro" />)

    // The current plan's CTA reads "Current plan" (a disabled button), never a
    // second "Subscribe" the customer could re-run.
    const current = await screen.findByRole('button', { name: /current plan/i })
    expect(current).toBeDisabled()
  })

  it('labels every paid tier a Subscribe for a free org', async () => {
    vi.stubGlobal('fetch', respond(PLANS))

    customRender(<TaskclanPlans currentPlan="free" />)

    // starter + pro + scale.
    await screen.findByText('Pro')
    expect(screen.getAllByRole('button', { name: /^subscribe$/i })).toHaveLength(3)
  })

  it('offers the portal to manage an existing subscription', async () => {
    vi.stubGlobal('fetch', respond(PLANS))

    customRender(<TaskclanPlans currentPlan="pro" />)

    expect(await screen.findByRole('button', { name: /manage subscription/i })).toBeInTheDocument()
  })

  it('routes Enterprise to sales rather than a self-serve price', async () => {
    vi.stubGlobal('fetch', respond(PLANS))

    customRender(<TaskclanPlans currentPlan="free" />)

    expect(await screen.findByRole('button', { name: /contact sales/i })).toBeInTheDocument()
  })

  it('says it could not load rather than rendering an empty offer', async () => {
    vi.stubGlobal('fetch', respond({ error: 'could not reach the Cloud API' }, false, 502))

    customRender(<TaskclanPlans currentPlan="free" />)

    await waitFor(() => expect(screen.getByText(/could not load plans/i)).toBeInTheDocument())
  })
})
