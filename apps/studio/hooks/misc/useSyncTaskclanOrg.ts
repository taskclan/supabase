/**
 * Keep the active organisation in step with the URL.
 *
 * Studio already switches organisation by navigating to `/org/{slug}`, which
 * makes the URL the real source of truth: it is shareable, it survives a
 * reload, and it cannot disagree with what the page is showing. The engine's
 * own console instead keeps the choice only in localStorage, which is why a
 * link to one of its pages can open in a different organisation than the sender
 * was looking at.
 *
 * All this does is copy that choice somewhere the fetch layer can read it, since
 * `taskclanFetch` has no access to the router.
 *
 * A legitimate `useEffect`: synchronising with an external system (browser
 * storage), not deriving state that could be computed in render.
 */
import { useParams } from 'common'
import { useEffect } from 'react'

import { setActiveOrg } from '@/lib/taskclan/activeOrg'

export function useSyncTaskclanOrg(): void {
  const { slug } = useParams()

  useEffect(() => {
    // Only on pages that name an organisation. Project pages do not, and
    // clearing it there would lose the selection on every navigation into one.
    if (slug) setActiveOrg(slug)
  }, [slug])
}
