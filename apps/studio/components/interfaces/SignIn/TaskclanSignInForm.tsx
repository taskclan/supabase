/**
 * Signing in to Taskclan Cloud.
 *
 * Deliberately not upstream's `SignInForm`, which is built for Supabase's
 * platform: hCaptcha, MFA assurance levels, audit-login events, funnel
 * telemetry and a forgot-password flow, none of which exist here. This talks to
 * the auth client directly, because these are auth calls rather than platform
 * API calls and there is no `data/**` query to route them through.
 *
 * Three ways in, all creating the account on first use (sign-in is sign-up):
 *   - GitHub / Google OAuth — `signInWithOAuth`, a full-page redirect out and
 *     back to `/sign-in` with the session in the URL.
 *   - A magic link — sent by the engine via Resend so the email is Taskclan's,
 *     not the shared Supabase project's Nani-branded default (POST to
 *     /api/taskclan/auth/magic-link, which proxies the engine). The default,
 *     because Cloud has no password of its own.
 *   - A password, behind `?mode=password`, for those who already set one.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { gotrueClient } from 'common'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button, Form, FormControl, FormField, Input } from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { FormItemLayout } from 'ui-patterns/form/FormItemLayout/FormItemLayout'
import z from 'zod'

import { TASKCLAN_PRODUCT_NAME } from '@/lib/constants'
import { DEFAULT_FALLBACK_PATH } from '@/lib/gotrue'

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Must be a valid email'),
  password: z.string(),
})

const formId = 'taskclan-sign-in'

/**
 * Where to send somebody once they are signed in.
 *
 * Only ever a path on this console. A `returnTo` that could name another origin
 * turns the sign-in page into an open redirect, and one that arrives already
 * signed in is exactly the kind of link worth being careful with.
 */
export function safeReturnTo(value: unknown): string {
  // Not '/'. That now serves the landing page, so defaulting to it would send
  // somebody who just signed in back to the marketing page they signed in from.
  if (typeof value !== 'string') return DEFAULT_FALLBACK_PATH
  return value.startsWith('/') && !value.startsWith('//') ? value : DEFAULT_FALLBACK_PATH
}

// Brand marks, inlined so the buttons carry no icon-package dependency.
const GithubMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.92 1.23 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.56 22.29 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
  </svg>
)
const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
    <path fill="#4285F4" d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 01-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.38z" />
    <path fill="#34A853" d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.03-6.45-4.75H1.7v2.98A11.5 11.5 0 0012 24z" />
    <path fill="#FBBC05" d="M5.55 14.67a6.9 6.9 0 010-4.34V7.35H1.7a11.5 11.5 0 000 10.3l3.85-2.98z" />
    <path fill="#EA4335" d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3A11.5 11.5 0 0012 0 11.5 11.5 0 001.7 6.2l3.85 2.98C6.46 6.78 9 4.75 12 4.75z" />
  </svg>
)

export const TaskclanSignInForm = () => {
  const router = useRouter()
  const usePassword = router.query.mode === 'password'
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null)
  const [oauthLoading, setOauthLoading] = useState<'github' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })
  const isSubmitting = form.formState.isSubmitting
  const busy = isSubmitting || oauthLoading !== null

  // A magic link — or an OAuth round-trip — lands back here with the session in
  // the URL, which the auth client parses on load. Watching for the session
  // rather than acting on the fragment directly means the same effect covers
  // arriving by link, arriving from a provider, and arriving already signed in.
  useEffect(() => {
    const { data } = gotrueClient.onAuthStateChange((_event, session) => {
      if (session) router.replace(safeReturnTo(router.query.returnTo))
    })
    return () => data.subscription.unsubscribe()
  }, [router])

  const signInWithProvider = async (provider: 'github' | 'google') => {
    setError(null)
    setOauthLoading(provider)
    const { error } = await gotrueClient.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/sign-in` },
    })
    // Success is a full-page redirect to the provider, so nothing follows it.
    if (error) {
      setError(error.message)
      setOauthLoading(null)
    }
  }

  const onSubmit = async ({ email, password }: z.infer<typeof schema>) => {
    setError(null)

    if (usePassword) {
      const { error } = await gotrueClient.signInWithPassword({ email, password })
      if (error) setError(error.message)
      // On success the auth-state listener above does the redirecting, so that
      // both ways in end up in the same place.
      return
    }

    // Ask the engine to send the link (branded, via Resend) rather than letting
    // the shared Supabase project send its own. The endpoint always answers ok
    // for a valid address, so a network/HTTP failure is the only real error.
    try {
      const res = await fetch('/api/taskclan/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectTo: `${window.location.origin}/sign-in` }),
      })
      if (!res.ok) {
        setError('Could not send a sign-in link just now. Please try again.')
        return
      }
      setLinkSentTo(email)
    } catch {
      setError('Could not reach the sign-in service. Please try again.')
    }
  }

  if (linkSentTo) {
    return (
      <Admonition type="default" title="Check your email">
        <p>
          A sign-in link is on its way to <span className="text-foreground">{linkSentTo}</span>. It
          opens {TASKCLAN_PRODUCT_NAME} in this browser.
        </p>
        <Button variant="text" className="mt-2 px-0" onClick={() => setLinkSentTo(null)}>
          Use a different email
        </Button>
      </Admonition>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Button
          block
          size="large"
          type="button"
          variant="outline"
          icon={<GithubMark />}
          loading={oauthLoading === 'github'}
          disabled={busy}
          onClick={() => signInWithProvider('github')}
        >
          Continue with GitHub
        </Button>
        <Button
          block
          size="large"
          type="button"
          variant="outline"
          icon={<GoogleMark />}
          loading={oauthLoading === 'google'}
          disabled={busy}
          onClick={() => signInWithProvider('google')}
        >
          Continue with Google
        </Button>
      </div>

      <div className="flex items-center gap-3 text-foreground-lighter" aria-hidden>
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Form {...form}>
        <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItemLayout label="Email">
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="you@example.com"
                    disabled={busy}
                  />
                </FormControl>
              </FormItemLayout>
            )}
          />

          {usePassword && (
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItemLayout label="Password">
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="current-password"
                      disabled={busy}
                    />
                  </FormControl>
                </FormItemLayout>
              )}
            />
          )}

          {error && (
            <Admonition type="destructive" title="Could not sign you in">
              {error}
            </Admonition>
          )}

          <Button block size="large" type="submit" loading={isSubmitting} disabled={busy}>
            {usePassword ? 'Sign in' : 'Email me a sign-in link'}
          </Button>

          {!usePassword && (
            // Sign-in and sign-up are the same action here: the link (or a
            // provider) creates the account on first use. New customers were
            // left hunting for a "Sign up" that does not exist; say so instead.
            <p className="-mt-1 text-center text-xs text-foreground-lighter">
              New to {TASKCLAN_PRODUCT_NAME}? Continue above — we&apos;ll create your account when you
              first sign in.
            </p>
          )}

          <Button
            block
            variant="text"
            size="small"
            className="text-foreground-light"
            onClick={() =>
              router.replace(
                { pathname: '/sign-in', query: usePassword ? {} : { mode: 'password' } },
                undefined,
                { shallow: true }
              )
            }
          >
            {usePassword ? 'Email me a link instead' : 'Sign in with a password'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
