/**
 * Taskclan Cloud — the console's front door.
 *
 * The console had none: `/` redirects into `/project/default`, so anyone
 * arriving at the URL landed inside someone's dashboard with no idea what the
 * product is. This is the page that answers that, in the shape supabase.com
 * uses — a hero that states the offer, a product grid, the commands you would
 * actually run, and what it costs.
 *
 * Not a copy of the engine's `/cloud/landing`. That one is the marketing site
 * on the Taskclan domain and stays; this is the console's own, sharing the
 * console's tokens so the page and the product it opens into look like one
 * thing.
 *
 * Everything asserted here is a capability that exists: per-second container
 * metering, managed Postgres, review apps, instant rollback, a hard spend cap.
 * A landing page that promises what the platform does not do is a support
 * ticket with a nicer font.
 */
import { ArrowRight, Check } from 'lucide-react'
import Head from 'next/head'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cloudSignupEnabledClient } from '@/lib/taskclan/signupFlag'

/** Products, named as the console names them so the page and the app agree. */
const PRODUCTS: Array<{ name: string; blurb: string; href: string }> = [
  {
    name: 'Deployments',
    blurb:
      'Push a branch or press Deploy. Builds run on Taskclan’s runners, roll the container, and keep every previous release one click away.',
    href: '/project/default/deployments',
  },
  {
    name: 'Postgres',
    blurb:
      'A managed database per app, with a table editor and SQL editor that connect as that app’s own role — never a shared one.',
    href: '/project/default/editor',
  },
  {
    name: 'Containers',
    blurb:
      'Long-running services metered per second, sized from the image, and asleep when idle so an unused app costs nothing.',
    href: '/project/default/compute',
  },
  {
    name: 'Logs & observability',
    blurb:
      'Build logs, container logs and request metrics in one place, kept long enough to answer “what changed at 3am?”.',
    href: '/project/default/logs/explorer',
  },
  {
    name: 'Environment',
    blurb:
      'Encrypted config per app and per environment. Values are write-only by default; reading one is a deliberate, audited act.',
    href: '/project/default/settings',
  },
  {
    name: 'Advisors',
    blurb:
      'Security and performance checks that read your actual schema — missing indexes, tables without RLS, policies that never match.',
    href: '/project/default/advisors/security',
  },
]

const INCLUDED = [
  'Unlimited seats, always free',
  'Review apps on every pull request',
  'Instant rollback to any release',
  'One-off containers for migrations and jobs',
  'A hard spend cap you set, enforced by the platform',
  'Custom domains with managed certificates',
]

function Section({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-6 ${className}`}>
      {children}
    </section>
  )
}

export default function LandingPage() {
  // With self-serve signup on, the CTAs lead to auth instead of straight into
  // the (now per-user) dashboard. Off ⇒ the original single-tenant links.
  const signup = cloudSignupEnabledClient()
  return (
    <>
      <Head>
        <title>Taskclan Cloud</title>
        <meta
          name="description"
          content="Ship a repository to a URL. Managed Postgres, per-second containers, review apps and rollback — on infrastructure you can read the bill for."
        />
      </Head>

      {/* data-theme is pinned dark: the landing is one deliberate composition,
          not a surface that should flip with a viewer's console preference. */}
      <div
        data-theme="dark"
        className="min-h-screen bg-background text-foreground [font-family:var(--font-sans,Figtree,ui-sans-serif,system-ui,sans-serif)]"
      >
        <header className="border-b border-muted">
          <Section className="flex h-16 items-center justify-between">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="inline-block size-5 rounded-[5px] bg-brand"
                style={{ boxShadow: '0 0 0 4px hsl(var(--brand-default) / 0.16)' }}
              />
              <span className="text-sm font-semibold tracking-tight">Taskclan Cloud</span>
            </span>
            <nav className="flex items-center gap-6 text-sm text-foreground-light">
              <a href="#products" className="hidden hover:text-foreground sm:inline">
                Products
              </a>
              <a href="#start" className="hidden hover:text-foreground sm:inline">
                Get started
              </a>
              <a href="#pricing" className="hidden hover:text-foreground sm:inline">
                Pricing
              </a>
              {signup ? (
                <>
                  <Link href="/sign-in" className="hidden hover:text-foreground sm:inline">
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
                    className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                  >
                    Sign up
                  </Link>
                </>
              ) : (
                <Link
                  href="/project/default"
                  className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                >
                  Open dashboard
                </Link>
              )}
            </nav>
          </Section>
        </header>

        {/* Hero. Sized to its content, not to the viewport: a 100vh opener
            pushes the page itself out of the first frame. */}
        <Section className="pb-16 pt-20 sm:pt-28">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-muted px-3 py-1 text-xs text-foreground-light">
            <span className="size-1.5 rounded-full bg-brand" />
            Every app on one control plane
          </p>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Ship a repository to a URL.
            <span className="block text-foreground-light">Pay for what actually runs.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-foreground-light">
            Taskclan Cloud builds your repo, runs it in a container, and gives it a managed Postgres
            database — with the dashboard, SQL editor and deploy history in one place. Containers
            are metered per second and sleep when idle, so an app nobody is using costs nothing.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={signup ? '/sign-up' : '/project/default/deployments'}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              {signup ? 'Get started free' : 'Deploy an app'} <ArrowRight size={15} />
            </Link>
            <Link
              href={signup ? '/sign-in' : '/project/default'}
              className="inline-flex items-center gap-2 rounded-md border border-strong px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-100"
            >
              {signup ? 'Sign in' : 'Open the dashboard'}
            </Link>
          </div>
        </Section>

        {/* The commands, early — the fastest way to say what using this is like. */}
        <Section id="start" className="pb-20">
          <div className="overflow-hidden rounded-lg border border-muted bg-surface-100">
            <div className="flex items-center gap-2 border-b border-muted px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-foreground-muted/40" />
              <span className="size-2.5 rounded-full bg-foreground-muted/40" />
              <span className="size-2.5 rounded-full bg-foreground-muted/40" />
              <span className="ml-2 text-xs text-foreground-lighter">your terminal</span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 text-[13px] leading-7">
              <code>
                <span className="text-foreground-lighter"># point Taskclan at a repository</span>
                {'\n'}
                <span className="text-brand">tsk</span> apps create my-api --repo taskclan/my-api
                {'\n\n'}
                <span className="text-foreground-lighter"># ship it</span>
                {'\n'}
                <span className="text-brand">tsk</span> deploy
                {'\n'}
                <span className="text-foreground-light">
                  {'  '}building… rolled after 3m16s{'\n'}
                  {'  '}https://my-api.taskclan.app
                </span>
                {'\n\n'}
                <span className="text-foreground-lighter"># a one-off, against the same database</span>
                {'\n'}
                <span className="text-brand">tsk</span> run -- npm run migrate
              </code>
            </pre>
          </div>
        </Section>

        <Section id="products" className="pb-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything an app needs, in one console
          </h2>
          <p className="mt-3 max-w-2xl text-foreground-light">
            The same dashboard runs the build, the database and the config. No second tool to
            reconcile, and no credential copied between them.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-muted bg-muted sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map((p) => (
              <Link
                key={p.name}
                href={p.href}
                className="group flex flex-col gap-2 bg-background p-6 transition-colors hover:bg-surface-100"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {p.name}
                  <ArrowRight
                    size={14}
                    className="text-foreground-lighter opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
                <span className="text-sm leading-relaxed text-foreground-light">{p.blurb}</span>
              </Link>
            ))}
          </div>
        </Section>

        <Section id="pricing" className="pb-24">
          <div className="grid gap-10 rounded-lg border border-muted p-8 lg:grid-cols-2 lg:p-12">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Metered per second. Seats are free.
              </h2>
              <p className="mt-4 leading-relaxed text-foreground-light">
                You are billed for the compute your containers actually use, not for a plan tier or
                a headcount. Idle apps sleep and stop costing. Set a spend cap and the platform
                enforces it — it will stop deploying before it surprises you.
              </p>
              <Link
                href="/project/default/deployments"
                className="mt-7 inline-flex items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                Deploy your first app <ArrowRight size={15} />
              </Link>
            </div>
            <ul className="grid content-start gap-3">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-foreground-light">
                  <Check size={16} className="mt-0.5 shrink-0 text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <footer className="border-t border-muted py-8">
          <Section className="flex flex-wrap items-center justify-between gap-4 text-sm text-foreground-lighter">
            <span>Taskclan Cloud</span>
            <Link href="/project/default" className="hover:text-foreground">
              Open dashboard
            </Link>
          </Section>
        </footer>
      </div>
    </>
  )
}

/**
 * No layout wrapper, deliberately.
 *
 * Every other page here mounts ProjectLayoutWithAuth, which resolves a project
 * and a session before it renders anything. A front door that requires the
 * thing it is introducing you to is not a front door.
 */
LandingPage.getLayout = (page: ReactNode) => page
