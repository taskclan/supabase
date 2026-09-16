import { Card, CardContent, CardHeader, CardTitle } from 'ui'

import { DocsButton } from '@/components/ui/DocsButton'
import { TASKCLAN_DOCS_URL } from '@/lib/constants'

/**
 * What to tell someone whose database settings are not managed from this screen.
 *
 * Upstream showed two cards here — "Local development & CLI", pointing at
 * `supabase/config.toml` and `supabase start`, and "Self-Hosted Supabase",
 * linking to the .env and docker-compose.yml in supabase/supabase. Both are
 * true for upstream's self-hosted users and neither is true here: Taskclan
 * Cloud has no config.toml, is not run from that compose file, and the Taskclan
 * CLI does not configure databases. It was instructions for a different
 * product, shown to every Taskclan user, since this branch IS the self-hosted
 * one.
 *
 * Replaced with the one accurate card rather than two retitled ones, and it
 * names where the setting actually lives instead of gesturing at docs.
 */
export function SettingsDatabaseEmptyStateLocal() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Taskclan Cloud</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground-light mb-4">
          Database settings are managed per app rather than on this screen. Choose a shared,
          managed, or bring-your-own Postgres when you create a project, or add one later from the
          app&apos;s Database page. Connection details live in the Connect panel. Anything beyond
          them, such as pooling or network rules, is set wherever that Postgres is hosted.
        </p>
        <DocsButton href={`${TASKCLAN_DOCS_URL}/docs/cloud/databases`} />
      </CardContent>
    </Card>
  )
}
