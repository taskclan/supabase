/**
 * The row's icon-only actions must carry an accessible name.
 *
 * Edit and delete are rendered as bare icons with a ButtonTooltip. A tooltip is
 * not a name: it needs hover or focus to exist, and the accessibility tree gets
 * nothing from it. Both buttons therefore announced as unlabelled, which on a
 * row that also offers a destructive action means the only way to tell them
 * apart was the SVG.
 *
 * Found by hand while deleting a test wrapper through the console: identifying
 * which button destroys things required reading `lucide-trash` off the markup.
 *
 * Queried by role and name, the way assistive tech resolves them, rather than
 * asserting on the aria-label attribute — visible text would be an equally
 * valid fix and this test should not forbid it.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WrapperRow } from './WrapperRow'
import { customRender } from '@/tests/lib/custom-render'

vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('common')>()),
  useParams: () => ({ ref: 'default', id: 'airtable_wrapper' }),
}))

vi.mock('@/hooks/misc/useCheckPermissions', () => ({
  useAsyncCheckPermissions: () => ({ can: true, isSuccess: true }),
}))

vi.mock('nuqs', () => ({
  useQueryState: () => [null, vi.fn()],
  parseAsString: {},
}))

const wrapper = {
  id: 1,
  name: 'demo_airtable',
  handler: 'airtable_fdw_handler',
  validator: 'airtable_fdw_validator',
  server_name: 'demo_airtable_server',
  server_options: ['api_key_id', 'secret-uuid'],
  tables: [],
} as never

const renderRow = () =>
  customRender(
    <table>
      <tbody>
        <WrapperRow wrapper={wrapper} />
      </tbody>
    </table>
  )

describe('WrapperRow actions', () => {
  it('names the edit action, including which wrapper it edits', () => {
    renderRow()
    expect(screen.getByRole('button', { name: /edit wrapper demo_airtable/i })).toBeInTheDocument()
  })

  it('names the destructive action, including which wrapper it deletes', () => {
    renderRow()
    expect(
      screen.getByRole('button', { name: /delete wrapper demo_airtable/i })
    ).toBeInTheDocument()
  })

  it('leaves no action button without a name', () => {
    const { container } = renderRow()

    const unnamed = [...container.querySelectorAll('button')].filter((button) => {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? ''
      return name.trim().length === 0
    })

    expect(unnamed, 'every button in the row should be reachable by name').toHaveLength(0)
  })
})
