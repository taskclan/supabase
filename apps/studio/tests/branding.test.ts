/**
 * Upstream branding must not come back into Taskclan-facing copy.
 *
 * This fork tracks supabase/supabase, so every merge can reintroduce strings
 * that name the wrong product. The ones below were each found in the UI rather
 * than by search: the console announcing itself as "Supabase Studio" to
 * browsers and link previews, protected schemas described as belonging to "your
 * Supabase project", an error blaming the "Supabase Dashboard".
 *
 * A source scan rather than a render, deliberately. Most of these sit behind a
 * condition that is awkward to reach — a browser extension breaking React, a
 * migration row with no timestamp — and the failure being guarded against is
 * textual, so the text is the thing to check. Rendering would prove less and
 * cost more.
 *
 * Scoped to the files that were fixed. This is not a ban on the word across the
 * console: supabase-js, the shared Supabase project and the bring-your-own
 * Supabase flow are all real here, and a blanket rule would fight them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Copy in these files must not name Supabase as the product the user is in. */
const cases: { file: string; banned: string[] }[] = [
  { file: 'pages/_app.tsx', banned: ['Supabase Studio'] },
  { file: 'components/layouts/OrganizationLayout.tsx', banned: ['Supabase Studio'] },
  { file: 'components/layouts/ProjectLayout/index.tsx', banned: ['Supabase Studio'] },
  { file: 'components/layouts/AccountLayout/AccountLayout.tsx', banned: ['Supabase Studio'] },
  { file: 'components/layouts/RealtimeLayout/RealtimeLayout.tsx', banned: ['Supabase Studio'] },
  // Not a ban on the word in this file. The auth and storage schemas really are
  // created and managed by Supabase, so "managed by Supabase" is a true
  // statement about a Postgres schema. What was wrong was "your Supabase
  // project" — the reader's project is a Taskclan one.
  {
    file: 'components/interfaces/Database/ProtectedSchemaWarning.tsx',
    banned: ['Supabase project'],
  },
  {
    file: 'components/ui/AIAssistantPanel/SupportRequestMessage.tsx',
    banned: ['Supabase Support'],
  },
  {
    file: 'components/ui/ErrorBoundary/InsertBeforeRemoveChildErrorHandler.tsx',
    banned: ['Supabase Dashboard'],
  },
  {
    file: 'components/interfaces/Settings/Integrations/VercelIntegration/VercelSection.tsx',
    banned: ['Supabase project', 'Supabase organization'],
  },
  {
    file: 'components/interfaces/Settings/Integrations/GithubIntegration/GitHubIntegrationConnectionForm.tsx',
    banned: ['Supabase project'],
  },
]

describe('Taskclan branding', () => {
  it.each(cases)('$file does not name Supabase as the product', ({ file, banned }) => {
    const source = read(file)
    // Comments explaining what was removed are allowed to quote the old string;
    // they are the record of why the line reads as it does.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

    for (const phrase of banned) {
      expect(code, `${file} still contains "${phrase}"`).not.toContain(phrase)
    }
  })

  it('the console names itself Taskclan Cloud to browsers and link previews', () => {
    const constants = read('lib/constants/index.ts')
    expect(constants).toContain("TASKCLAN_PRODUCT_NAME = 'Taskclan Cloud'")

    // application-name is what a browser shows when the console is installed or
    // pinned; description is what a shared link unfurls as.
    expect(read('pages/_app.tsx')).toContain('applicationName={TASKCLAN_PRODUCT_NAME}')
    for (const layout of [
      'components/layouts/OrganizationLayout.tsx',
      'components/layouts/ProjectLayout/index.tsx',
      'components/layouts/AccountLayout/AccountLayout.tsx',
      'components/layouts/RealtimeLayout/RealtimeLayout.tsx',
    ]) {
      expect(read(layout)).toContain('content={TASKCLAN_PRODUCT_NAME}')
    }
  })
})
