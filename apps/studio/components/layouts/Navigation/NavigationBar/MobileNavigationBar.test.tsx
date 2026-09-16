/**
 * The mobile header renders the Taskclan mark exactly once.
 *
 * It used to render it twice on self-hosted. The mark had two independent
 * reasons to appear — an unconditional one for self-hosted (which has no org
 * switcher, so the logo is the only way home) and a bare `else` fallback at the
 * end of the scope ternary — and on a non-project screen both were true at the
 * same time. Upstream never saw it because the fallback is only reachable on
 * platform when the org selector is hidden; this console runs self-hosted,
 * where every Projects screen showed two logos side by side.
 *
 * Counting the rendered marks rather than asserting on the branch conditions:
 * the defect was two correct-looking branches agreeing, which a condition-level
 * test reproduces instead of catching.
 */
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MobileNavigationBar } from './MobileNavigationBar'
import { customRender } from '@/tests/lib/custom-render'

const params = vi.hoisted(() => ({ value: {} as { ref?: string; slug?: string } }))

vi.mock('common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('common')>()),
  useParams: () => params.value,
}))

// The bar's siblings pull in dropdowns, sheets and the Connect flow. None of
// them render a logo, so they are noise for this question — stubbed to keep the
// test about the header's own branching.
vi.mock('./OrgSelector', () => ({ OrgSelector: () => <div data-testid="org-selector" /> }))
vi.mock('./ProjectBranchSelector', () => ({
  ProjectBranchSelector: () => <div data-testid="branch-selector" />,
}))
vi.mock('@/components/interfaces/ConnectButton/ConnectButton', () => ({
  ConnectButton: () => <div data-testid="connect" />,
}))
vi.mock('@/components/interfaces/UserDropdown', () => ({ UserDropdown: () => null }))
vi.mock('@/components/interfaces/LocalDropdown', () => ({ LocalDropdown: () => null }))
vi.mock('@/components/interfaces/Sidebar', () => ({ SidebarContent: () => null }))
vi.mock(
  '@/components/layouts/Navigation/FloatingMobileToolbar/FloatingMobileToolbar',
  () => ({ FloatingMobileToolbar: () => null })
)
vi.mock('./MobileSheetContext', () => ({
  useMobileSheet: () => ({ openMenu: vi.fn() }),
}))

// The bar and HomeIcon each read org state and a branding flag. Stubbed so the
// test neither reaches the network (unhandled requests are a failure here) nor
// depends on which way a flag happens to resolve — the logo count is the
// question, and it should not vary with either.
vi.mock('@/hooks/misc/useIsFeatureEnabled', () => ({ useIsFeatureEnabled: () => false }))
vi.mock('@/hooks/misc/useSelectedOrganization', () => ({
  useSelectedOrganizationQuery: () => ({ data: undefined }),
}))
vi.mock('@/data/organizations/organizations-query', () => ({
  useOrganizationsQuery: () => ({ data: [], isPending: false }),
}))

const marks = () => screen.queryAllByAltText('Taskclan')

describe('MobileNavigationBar — self-hosted', () => {
  beforeEach(() => {
    params.value = {}
  })

  it('shows one home mark on a non-project screen', () => {
    // IS_PLATFORM is false unless NEXT_PUBLIC_IS_PLATFORM is 'true', which is
    // the console's own configuration — so this is the real shipped path, and
    // the one that rendered the logo twice.
    customRender(<MobileNavigationBar />)
    expect(marks()).toHaveLength(1)
  })

  it('shows one home mark inside a project, alongside the project controls', () => {
    params.value = { ref: 'default' }
    customRender(<MobileNavigationBar />)

    expect(marks()).toHaveLength(1)
    expect(screen.getByTestId('branch-selector')).toBeInTheDocument()
  })

  it('does not fall back to the org selector, which self-hosted has no use for', () => {
    params.value = { slug: 'default-org-slug' }
    customRender(<MobileNavigationBar />)

    expect(marks()).toHaveLength(1)
    expect(screen.queryByTestId('org-selector')).not.toBeInTheDocument()
  })
})
