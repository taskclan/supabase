/**
 * Signing in to Taskclan Cloud.
 *
 * Deliberately not upstream's `SignInForm`, which is built for Supabase's
 * platform: hCaptcha, MFA assurance levels, audit-login events, funnel
 * telemetry and a forgot-password flow, none of which exist here. This talks to
 * the auth client directly, because these are auth calls rather than platform
 * API calls and there is no `data/**` query to route them through.
 *
 * A magic link is the default because Cloud has no password of its own: accounts
 * come from the same Supabase project the engine's products use, so plenty of
 * people have never set one. The password path stays available behind
 * `?mode=password` for those who have one already.
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
function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/'
  return value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export const TaskclanSignInForm = () => {
  const router = useRouter()
  const usePassword = router.query.mode === 'password'
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })
  const isSubmitting = form.formState.isSubmitting

  // A magic link lands back here with the session in the URL fragment, which the
  // auth client parses on load. Watching for the session rather than acting on
  // the fragment directly means the same effect covers arriving by link and
  // arriving on a console that is already signed in.
  useEffect(() => {
    const { data } = gotrueClient.onAuthStateChange((_event, session) => {
      if (session) router.replace(safeReturnTo(router.query.returnTo))
    })
    return () => data.subscription.unsubscribe()
  }, [router])

  const onSubmit = async ({ email, password }: z.infer<typeof schema>) => {
    setError(null)

    if (usePassword) {
      const { error } = await gotrueClient.signInWithPassword({ email, password })
      if (error) setError(error.message)
      // On success the auth-state listener above does the redirecting, so that
      // both ways in end up in the same place.
      return
    }

    const { error } = await gotrueClient.signInWithOtp({
      email,
      options: {
        // Back to this page, which is public. If the link landed on a gated
        // page the gate could redirect before the client had parsed the
        // fragment, and the link would look broken.
        emailRedirectTo: `${window.location.origin}/sign-in`,
      },
    })
    if (error) setError(error.message)
    else setLinkSentTo(email)
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
                  disabled={isSubmitting}
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
                    disabled={isSubmitting}
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

        <Button block size="large" type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {usePassword ? 'Sign in' : 'Email me a sign-in link'}
        </Button>

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
  )
}
