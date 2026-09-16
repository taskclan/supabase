/**
 * The two empty states of the publications list, which used to be one.
 *
 * `NoSearchResults` was rendered whenever the list came back empty, without
 * checking whether anything had been searched for. A database with no
 * publications is the normal starting point rather than an edge case, so the
 * default view of this screen told the reader their search for "" had returned
 * nothing, beside a Reset filter button with no filter to reset.
 *
 * Both directions are asserted: it is equally wrong to describe a genuinely
 * failed search as "nothing here yet", which is what a one-sided fix produces.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicationsList } from './PublicationsList'
import { customRender } from '@/tests/lib/custom-render'

const publications = vi.hoisted(() => ({ value: [] as unknown[] }))

vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('common')>()),
  useParams: () => ({ ref: 'default' }),
}))

vi.mock('@/hooks/misc/useSelectedProject', () => ({
  useSelectedProjectQuery: () => ({
    data: { ref: 'default', connectionString: 'postgresql://localhost' },
  }),
}))

vi.mock('@/data/database-publications/database-publications-query', () => ({
  useDatabasePublicationsQuery: () => ({
    data: publications.value,
    error: null,
    isPending: false,
    isSuccess: true,
    isError: false,
  }),
}))

vi.mock('@/data/database-publications/database-publications-update-mutation', () => ({
  useDatabasePublicationUpdateMutation: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/hooks/misc/useCheckPermissions', () => ({
  useAsyncCheckPermissions: () => ({ can: true, isSuccess: true }),
}))

const aPublication = {
  id: 1,
  name: 'demo_pub',
  owner: 'postgres',
  publish_insert: true,
  publish_update: true,
  publish_delete: true,
  publish_truncate: true,
  tables: [],
}

describe('PublicationsList empty states', () => {
  beforeEach(() => {
    publications.value = []
  })

  it('says there are none yet when none exist and nothing was searched', () => {
    customRender(<PublicationsList />)

    expect(screen.getByText('No publications yet')).toBeInTheDocument()
    expect(screen.queryByText(/did not return any results/)).not.toBeInTheDocument()
  })

  it('does not offer to reset a filter that was never set', () => {
    // The button the old state rendered. Pressing it changed nothing, because
    // the filter it cleared was already empty.
    customRender(<PublicationsList />)

    expect(screen.queryByText(/Reset filter/)).not.toBeInTheDocument()
  })

  it('still reports a search that matched nothing', async () => {
    publications.value = [aPublication]
    customRender(<PublicationsList />)
    expect(screen.getByText('demo_pub')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Search for a publication'), 'zzz-nope')

    expect(screen.queryByText('demo_pub')).not.toBeInTheDocument()
    expect(screen.getByText(/did not return any results/)).toBeInTheDocument()
    // The genuine search-empty case is the one place this message belongs.
    expect(screen.queryByText('No publications yet')).not.toBeInTheDocument()
  })
})
