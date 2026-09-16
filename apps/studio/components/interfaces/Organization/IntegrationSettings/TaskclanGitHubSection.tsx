/**
 * GitHub, connected through Taskclan Cloud rather than Supabase's platform.
 *
 * Upstream's `GithubSection` renders on this page and cannot work here: every
 * request it makes goes to Supabase's own integrations API, which this build
 * does not serve, so "Add connection" was a button that could only fail.
 *
 * Taskclan has the real thing already. Cloud runs a GitHub App, records which
 * installations belong to an organisation, and uses them to import and redeploy
 * repositories; the new-project form has been reading the same endpoints all
 * along. This surfaces that on the Integrations page, which is where somebody
 * goes looking for it.
 *
 * Connecting is a redirect rather than a form. The install URL carries state
 * that only Cloud can sign (the org and user, so its callback can attribute the
 * installation), and the app is installed on GitHub's side, not ours.
 */
import { ExternalLink, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, CardContent } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { FormLayout } from 'ui-patterns/form/Layout/FormLayout'
import { GenericSkeletonLoader } from 'ui-patterns/ShimmeringLoader'

import { IntegrationSectionIcon } from '@/components/interfaces/Settings/Integrations/IntegrationsSettings'
import { taskclanFetch } from '@/lib/taskclan/fetchTaskclan'

interface Installation {
  installationId?: number
  accountLogin?: string
  accountType?: string | null
}

interface ReposResponse {
  installations?: Installation[]
  repos?: unknown[]
}

export const TaskclanGitHubSection = () => {
  const [data, setData] = useState<ReposResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await taskclanFetch('/api/taskclan/github/repos')
        const body = await res.json()
        if (!live) return
        if (!res.ok) setError(body?.error ?? `Taskclan Cloud answered ${res.status}`)
        else setData(body as ReposResponse)
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not reach Taskclan Cloud')
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const connect = async () => {
    setIsConnecting(true)
    try {
      // Cloud signs the state, so the URL has to come from it. Sending the
      // current page as returnTo means GitHub hands the person back where they
      // started instead of to a default.
      const returnTo = window.location.origin
      const res = await taskclanFetch(
        `/api/taskclan/github/connect?returnTo=${encodeURIComponent(returnTo)}`
      )
      const body = await res.json()
      if (!res.ok || !body?.url) {
        toast.error(body?.error ?? 'Could not start the GitHub connection')
        return
      }
      window.location.href = body.url as string
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the GitHub connection')
    } finally {
      setIsConnecting(false)
    }
  }

  const installations = data?.installations ?? []
  const repoCount = data?.repos?.length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <IntegrationSectionIcon title="github" />
        <div>
          <h3 className="text-foreground">GitHub</h3>
          <p className="text-sm text-foreground-light">
            Import a repository and redeploy it when you push.
          </p>
        </div>
      </div>

      {error && (
        <Admonition type="warning" title="Could not load your GitHub connections">
          {error}
        </Admonition>
      )}

      {!data && !error && <GenericSkeletonLoader />}

      {data && installations.length === 0 && (
        <Card>
          <CardContent>
            <FormLayout
              layout="flex-row-reverse"
              label="GitHub account"
              description="Connect an account to import and redeploy its repositories"
            >
              <Button icon={<Plus />} size="tiny" loading={isConnecting} onClick={connect}>
                Connect GitHub
              </Button>
            </FormLayout>
          </CardContent>
        </Card>
      )}

      {data && installations.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            {installations.map((installation) => (
              <FormLayout
                key={installation.installationId ?? installation.accountLogin}
                layout="flex-row-reverse"
                label={installation.accountLogin ?? 'GitHub account'}
                description={
                  installation.accountType
                    ? `${installation.accountType} account`
                    : 'Connected to this organization'
                }
              >
                <Button
                  asChild
                  variant="default"
                  size="tiny"
                  iconRight={<ExternalLink size={14} />}
                >
                  <a
                    href={
                      installation.installationId
                        ? `https://github.com/settings/installations/${installation.installationId}`
                        : 'https://github.com/settings/installations'
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Configure
                  </a>
                </Button>
              </FormLayout>
            ))}

            <FormLayout
              layout="flex-row-reverse"
              label="Repositories"
              description={
                // The count is what the installations can actually deploy, so
                // it says whether the connection is useful rather than just
                // present.
                repoCount === 1 ? '1 repository available' : `${repoCount} repositories available`
              }
            >
              <Button
                icon={<Plus />}
                variant="default"
                size="tiny"
                loading={isConnecting}
                onClick={connect}
              >
                Connect another
              </Button>
            </FormLayout>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
