/**
 * The billing screen, which replaced one showing four copies of "Failed to
 * retrieve subscription" and a cycle running January 01 to January 01.
 *
 * The tests lean on the states that mislead rather than the happy path. A
 * billing screen that renders a confident wrong number is worse than one that
 * admits it could not load, because nobody re-checks a figure that looked fine.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskclanBilling } from './TaskclanBilling'
import { customRender } from '@/tests/lib/custom-render'

const CREDITS = {
  plan: 'pro',
  balanceCredits: 9976488,
  balanceUsd: 9976.488,
  usage: { periodDays: 30, totalUsd: 512.594 },
  packs: [
    { id: 'cloud_10', label: 'Starter', priceUsd: 10, credits: 10000, bonusPct: 0 },
    { id: 'cloud_50', label: 'Builder', priceUsd: 50, credits: 55000, bonusPct: 10 },
  ],
}

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TaskclanBilling', () => {
  it('leads with the balance, which is the number this model turns on', async () => {
    vi.stubGlobal('fetch', respond(CREDITS))

    customRender(<TaskclanBilling />)

    expect(await screen.findByText('$9,976.49')).toBeInTheDocument()
  })

  it('describes the runway as an estimate rather than a date', async () => {
    // It assumes the next month looks like the last, which is exactly what it
    // will not do the moment somebody deploys something. Worth showing, not
    // worth promising.
    vi.stubGlobal('fetch', respond(CREDITS))

    customRender(<TaskclanBilling />)

    expect(await screen.findByText(/about \d+ days left at that rate/i)).toBeInTheDocument()
  })

  it('shows each pack with the bonus it actually carries', async () => {
    vi.stubGlobal('fetch', respond(CREDITS))

    customRender(<TaskclanBilling />)

    expect(await screen.findByText('55,000 credits · 10% extra')).toBeInTheDocument()
  })

  it('offers no runway when nothing has been spent', async () => {
    // Dividing by a zero spend gives Infinity, which would render as an
    // infinite number of days remaining on a billing page.
    vi.stubGlobal('fetch', respond({ ...CREDITS, usage: { periodDays: 30, totalUsd: 0 } }))

    customRender(<TaskclanBilling />)

    await screen.findByText('$9,976.49')
    expect(screen.queryByText(/days left at that rate/i)).not.toBeInTheDocument()
  })

  it('says it could not load rather than showing a zero balance', async () => {
    // A balance of $0.00 is a specific, alarming claim, and the one a failed
    // fetch would produce if the error state were skipped.
    vi.stubGlobal('fetch', respond({ error: 'could not reach the Cloud API' }, false, 502))

    customRender(<TaskclanBilling />)

    await waitFor(() => expect(screen.getByText(/could not load billing/i)).toBeInTheDocument())
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })
})

/**
 * Sales tax. Charges carry GST/HST only once Stripe knows where the customer
 * is. Customers from before tax was on may have no address, so the page asks
 * the one person who can add it (the owner, in the billing portal) and tells
 * everyone else who to ask.
 */
describe('TaskclanBilling — sales tax', () => {
  const route = (credits: object) => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        calls.push(u)
        const body = u.endsWith('/api/taskclan/credits')
          ? credits
          : u.includes('/billing/subscribe')
            ? { portalUrl: 'https://billing.stripe.test/p' }
            : {}
        return { ok: true, status: 200, json: async () => body } as unknown as Response
      })
    )
    return calls
  }

  const realLocation = window.location
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true })
  })

  it('asks an owner with no address to add one, in the billing portal', async () => {
    const loc = { href: '' }
    Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true })
    route({ ...CREDITS, role: 'owner', taxEnabled: true, billingAddressNeeded: true })

    customRender(<TaskclanBilling />)
    expect(await screen.findByText('Add your billing address')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add billing address' }))

    await waitFor(() => expect(loc.href).toBe('https://billing.stripe.test/p'))
  })

  it('tells anyone else to ask the owner', async () => {
    route({ ...CREDITS, role: 'developer', taxEnabled: true, billingAddressNeeded: true })

    customRender(<TaskclanBilling />)

    expect(await screen.findByText('Ask your workspace owner to add it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add billing address' })).not.toBeInTheDocument()
  })

  it('says tax goes on top only once tax is on', async () => {
    route({ ...CREDITS, taxEnabled: true, billingAddressNeeded: false })
    const { unmount } = customRender(<TaskclanBilling />)
    // Under the plans and under the packs: both are prices.
    expect(await screen.findAllByText(/GST\/HST is added for customers in Canada/)).toHaveLength(2)
    expect(screen.queryByText('Add your billing address')).not.toBeInTheDocument()
    unmount()

    route({ ...CREDITS, taxEnabled: false })
    customRender(<TaskclanBilling />)
    await screen.findByText('$9,976.49')
    expect(screen.queryByText(/GST\/HST/)).not.toBeInTheDocument()
  })
})
