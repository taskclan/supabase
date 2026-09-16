import { Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from 'ui'
import { EmptyStatePresentational } from 'ui-patterns/EmptyStatePresentational'

import CommandRender from '@/components/interfaces/Functions/CommandRender'

/** Stands in for the app's own connection string, which is not printed here. */
const DB_URL_PLACEHOLDER = '"$DATABASE_URL"'

/**
 * How migrations are actually run against a Taskclan app.
 *
 * The previous instructions could not work. They opened with
 * `supabase link --project-ref <ref>` using the app's Taskclan ref, and that
 * flag wants a Supabase project reference, so the command failed on its first
 * line for everyone who followed it and `db push` afterwards had no linked
 * project to push to.
 *
 * `--db-url` is the way in: it takes a connection string and targets any
 * Postgres, so nothing needs linking and the app's own scoped credential does
 * the work. The string is the one Connect already shows, and it is
 * deliberately NOT interpolated here, because it carries the app's password
 * and this panel gets screenshotted into issues.
 *
 * Verified against a real database rather than read off the help text: init,
 * migration new, then db push --db-url applied a migration and it appeared in
 * the list this empty state is replaced by.
 */
export const MigrationsEmptyState = () => {
  const commands = [
    {
      comment: 'Set up a migrations folder, once per repo',
      command: `supabase init`,
      jsx: () => {
        return (
          <>
            <span className="text-brand-600">supabase</span> init
          </>
        )
      },
    },
    {
      comment: 'Create a new migration called "new-migration"',
      command: `supabase migration new new-migration`,
      jsx: () => {
        return (
          <>
            <span className="text-brand-600">supabase</span> migration new new-migration
          </>
        )
      },
    },
    {
      comment: "Apply them, using this app's connection string from Connect",
      command: `supabase db push --db-url ${DB_URL_PLACEHOLDER}`,
      jsx: () => {
        return (
          <>
            <span className="text-brand-600">supabase</span> db push --db-url {DB_URL_PLACEHOLDER}
          </>
        )
      },
    },
  ]

  return (
    <EmptyStatePresentational
      icon={Terminal}
      title="Run your first migration"
      description="Migrations are plain SQL files, applied against this app's database by connection string. Nothing needs linking. Copy the string from Connect."
      className="gap-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>Terminal instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <CommandRender commands={commands} />
        </CardContent>
      </Card>
    </EmptyStatePresentational>
  )
}
