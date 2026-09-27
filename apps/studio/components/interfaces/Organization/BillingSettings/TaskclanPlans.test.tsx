/**
 * The plan tiers — the primary billing surface.
 *
 * The tests lean on the states that decide what a customer can do: which plan is
 * theirs (so its button is inert rather than another "Subscribe"), whether they
 * already subscribe (so the entry point is "Manage" via the portal, not a second
 * Checkout), and that Enterprise routes to sales rather than a self-serve price.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

/**
 * Switching between paid plans. The engine charges or credits the difference
 * the moment the switch happens, so nothing is sent with `confirm: true` until
 * the customer has seen the amount, and the confirm carries the preview's
 * proration date so the charge is that amount exactly.
 */
describe('TaskclanPlans — switching a paid plan', () => {
  type Call = { url: string; body: Record<string, unknown> | null }

  const PREVIEW = {
    plan: 'scale',
    currentPlan: 'pro',
    direction: 'upgrade',
    currentMonthlyUsd: 39,
    newMonthlyUsd: 129,
    dueNowUsd: 87.73,
    accountCreditUsd: 0,
    renewsAt: '2026-10-26T21:45:00.000Z',
    resumes: false,
    prorationDate: 1790477880,
  }

  const route = (handle: (c: Call) => { body: unknown; ok?: boolean; status?: number } | undefined) => {
    const calls: Call[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const call = { url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null }
        calls.push(call)
        const r = call.url.includes('/api/taskclan/plans') ? { body: PLANS } : handle(call) ?? { body: {} }
        return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body } as unknown as Response
      })
    )
    return calls
  }

  const realLocation = window.location
  const stubLocation = () => {
    const loc = { href: '', reload: vi.fn() }
    Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true })
    return loc
  }
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true })
  })

  const subscribeCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/billing/subscribe'))

  it('shows the prorated amount first, then switches with the preview date', async () => {
    const loc = stubLocation()
    const calls = route((c) =>
      c.body?.action === 'preview_switch' ? { body: { preview: PREVIEW } } : { body: { ok: true, switched: 'updated', plan: 'scale' } }
    )

    customRender(<TaskclanPlans currentPlan="pro" />)
    fireEvent.click(await screen.findByRole('button', { name: /^upgrade$/i }))

    expect(await screen.findByText('$87.73')).toBeInTheDocument()
    expect(screen.getByText('$129.00/mo')).toBeInTheDocument()
    // Nothing that could charge has been sent yet.
    expect(subscribeCalls(calls).map((c) => c.body)).toEqual([{ action: 'preview_switch', plan: 'scale' }])

    fireEvent.click(screen.getByRole('button', { name: 'Pay $87.73 and switch' }))
    await waitFor(() => expect(loc.reload).toHaveBeenCalled())
    expect(subscribeCalls(calls)[1].body).toEqual({ action: 'upgrade', plan: 'scale', confirm: true, prorationDate: 1790477880 })
  })

  it('shows a downgrade as a credit, with nothing charged', async () => {
    stubLocation()
    route(() => ({ body: { preview: { ...PREVIEW, plan: 'starter', direction: 'downgrade', newMonthlyUsd: 12, dueNowUsd: -25.7 } } }))

    customRender(<TaskclanPlans currentPlan="pro" />)
    fireEvent.click((await screen.findAllByRole('button', { name: /^downgrade$/i }))[1]) // [Free, Starter]

    expect(await screen.findByText('Credit for unused Pro')).toBeInTheDocument()
    expect(screen.getByText('$25.70')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Starter' })).toBeEnabled()
  })

  it('splits the GST/HST out of what is due now', async () => {
    stubLocation()
    route(() => ({ body: { preview: { ...PREVIEW, dueNowUsd: 99.13, taxUsd: 11.4 } } }))

    customRender(<TaskclanPlans currentPlan="pro" />)
    fireEvent.click(await screen.findByRole('button', { name: /^upgrade$/i }))

    expect(await screen.findByText('GST/HST')).toBeInTheDocument()
    expect(screen.getByText('$11.40')).toBeInTheDocument()
    expect(screen.getByText('$87.73')).toBeInTheDocument() // the plan change before tax
    expect(screen.getByRole('button', { name: 'Pay $99.13 and switch' })).toBeInTheDocument()
  })

  it('says how much account credit covers and charges the card only the rest', async () => {
    stubLocation()
    route(() => ({ body: { preview: { ...PREVIEW, accountCreditUsd: 50 } } }))

    customRender(<TaskclanPlans currentPlan="pro" />)
    fireEvent.click(await screen.findByRole('button', { name: /^upgrade$/i }))

    expect(await screen.findByText('Paid from your account credit')).toBeInTheDocument()
    expect(screen.getByText('$37.73')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay $37.73 and switch' })).toBeInTheDocument()
  })

  it('keeps the dialog open with the reason when the card is declined', async () => {
    const loc = stubLocation()
    route((c) =>
      c.body?.action === 'preview_switch'
        ? { body: { preview: PREVIEW } }
        : { ok: false, status: 402, body: { code: 'payment_failed', error: "Your card couldn't be charged for the new plan, so your plan wasn't changed." } }
    )

    customRender(<TaskclanPlans currentPlan="pro" />)
    fireEvent.click(await screen.findByRole('button', { name: /^upgrade$/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $87.73 and switch' }))

    expect(await screen.findByText(/your card couldn't be charged/i)).toBeInTheDocument()
    expect(loc.reload).not.toHaveBeenCalled()
  })

  it('subscribes through Checkout when the plan has no subscription behind it', async () => {
    const loc = stubLocation()
    const calls = route((c) =>
      c.body?.action === 'preview_switch'
        ? { ok: false, status: 409, body: { code: 'no_subscription', error: 'there is no subscription to switch yet' } }
        : { body: { checkoutUrl: 'https://checkout.stripe.test/c' } }
    )

    customRender(<TaskclanPlans currentPlan="pro" />)
    fireEvent.click(await screen.findByRole('button', { name: /^upgrade$/i }))

    await waitFor(() => expect(loc.href).toBe('https://checkout.stripe.test/c'))
    expect(subscribeCalls(calls)[1].body).toEqual({ action: 'upgrade', plan: 'scale' })
  })
})
