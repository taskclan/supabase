/**
 * Database Settings must not hand out another product's instructions.
 *
 * This screen's self-hosted branch is the one every Taskclan user sees, and it
 * shipped upstream's copy verbatim: edit `supabase/config.toml` and run
 * `supabase start`, or change the .env and docker-compose.yml in
 * supabase/supabase. None of that exists in Taskclan Cloud, so the advice was
 * not merely unbranded — it was unfollowable.
 *
 * The assertions are mostly negative on purpose. Wording will drift; what must
 * not come back is a reference to a file or command this product does not have.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingsDatabaseEmptyStateLocal } from './SettingsDatabaseEmptyStateLocal'

describe('SettingsDatabaseEmptyStateLocal', () => {
  it('is titled for Taskclan Cloud, not for self-hosted Supabase', () => {
    render(<SettingsDatabaseEmptyStateLocal />)

    expect(screen.getByText('Taskclan Cloud')).toBeInTheDocument()
    expect(screen.queryByText(/Self-Hosted Supabase/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Local development & CLI/i)).not.toBeInTheDocument()
  })

  it('names no file or command that Taskclan Cloud does not have', () => {
    const { container } = render(<SettingsDatabaseEmptyStateLocal />)
    const text = container.textContent ?? ''

    for (const absent of ['config.toml', 'supabase start', 'docker-compose', '.env file']) {
      expect(text).not.toContain(absent)
    }
  })

  it('sends the reader to Taskclan docs rather than supabase.com or the compose file', () => {
    const { container } = render(<SettingsDatabaseEmptyStateLocal />)
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')

    expect(hrefs.length).toBeGreaterThan(0)
    expect(hrefs.some((h) => h.includes('docs.taskclan.com'))).toBe(true)
    // github.com/supabase/supabase/blob/master/docker/... is where the old
    // links went, and it is a live URL — so a broken-link check would not have
    // caught this. Only the destination being the wrong product does.
    expect(hrefs.some((h) => h.includes('supabase.com') || h.includes('github.com/supabase'))).toBe(
      false
    )
  })
})
