/**
 * The billing screen, which replaced one showing four copies of "Failed to
 * retrieve subscription" and a cycle running January 01 to January 01.
 *
 * The tests lean on the states that mislead rather than the happy path. A
 * billing screen that renders a confident wrong number is worse than one that
 * admits it could not load, because nobody re-checks a figure that looked fine.
 */
import { screen, waitFor } from '@testing-library/react'
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
