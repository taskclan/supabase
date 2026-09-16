import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { Button } from 'ui'

import { SignInForm } from '@/components/interfaces/SignIn/SignInForm'
import { SignInOptions } from '@/components/interfaces/SignIn/SignInOptions'
import { SignInWithExternalProvider } from '@/components/interfaces/SignIn/SignInWithExternalProvider'
import { TaskclanSignInForm } from '@/components/interfaces/SignIn/TaskclanSignInForm'
import { AuthenticationLayout } from '@/components/layouts/AuthenticationLayout'
import { SignInLayout } from '@/components/layouts/SignInLayout/SignInLayout'
import { geistSans } from '@/fonts'
import { useCustomContent } from '@/hooks/custom-content/useCustomContent'
import { useEnabledIdentityProviders } from '@/hooks/misc/useEnabledIdentityProviders'
import { useInboundBranding } from '@/hooks/misc/useInboundBranding'
import { useIsFeatureEnabled } from '@/hooks/misc/useIsFeatureEnabled'
import {
  BASE_PATH,
  IS_PLATFORM,
  TASKCLAN_AUTH_ENABLED,
  TASKCLAN_PRODUCT_NAME,
} from '@/lib/constants'
import { getSignUpReturnTo } from '@/lib/gotrue'
import type { NextPageWithLayout } from '@/types'

const PlatformSignInPage: NextPageWithLayout = () => {
  const router = useRouter()
  const [showOtherOptions, setShowOtherOptions] = useState(false)

  const {
    dashboardAuthSignInWithSso: signInWithSsoEnabled,
    dashboardAuthSignInWithEmail: signInWithEmailEnabled,
    dashboardAuthSignUp: signUpEnabled,
  } = useIsFeatureEnabled([
    'dashboard_auth:sign_in_with_sso',
    'dashboard_auth:sign_in_with_email',
    'dashboard_auth:sign_up',
  ])

  const {
    dashboardAuthCustomProvider: customProvider,
    dashboardAuthCustomProviders: customProvidersNew,
  } = useCustomContent(['dashboard_auth:custom_provider', 'dashboard_auth:custom_providers'])

  // [Joshen] This is just for backward compatibility - singular customProvider needs to be deprecated subsequently
  // Just need to remove customProvider and rename customProvidersNew to customProviders
  const customProviders = customProvidersNew ?? (customProvider ? [customProvider] : [])

  const { focusProvider } = useInboundBranding('sign-in')
  const signInProviders = useEnabledIdentityProviders().filter((provider) => provider.showOnSignIn)

  useEffect(() => {
    if (!IS_PLATFORM) {
      // on selfhosted instance just redirect to projects page
      router.replace('/project/default')
    }
  }, [router])

  // Inbound link focused us on a single provider — lead with that one (SignInLayout renders the
  // matching interstitial frame around it), but let the user reveal the rest of our options.
  if (focusProvider) {
    const otherProviders = signInProviders.filter((provider) => provider.id !== focusProvider.id)
    const hasOtherOptions =
      otherProviders.length > 0 ||
      signInWithSsoEnabled ||
      customProviders.length > 0 ||
      signInWithEmailEnabled

    return (
      <div className="flex flex-col gap-5">
        <SignInWithExternalProvider provider={focusProvider} />

        {hasOtherOptions &&
          (showOtherOptions ? (
            <>
              <SignInOptions providers={otherProviders} dividerBgClass="bg-surface-100" />
              {signInWithEmailEnabled && <SignInForm />}
            </>
          ) : (
            <Button
              block
              variant="text"
              size="large"
              className="-mt-2 text-foreground-light"
              onClick={() => setShowOtherOptions(true)}
            >
              Show other options
            </Button>
          ))}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <SignInOptions providers={signInProviders} />
        {signInWithEmailEnabled && <SignInForm />}
      </div>

      {signUpEnabled && (
        <div className="self-center my-8 text-sm">
          <span className="text-foreground-light">Don’t have an account?</span>{' '}
          <Link
            href={{
              pathname: '/sign-up',
              query: { ...router.query, returnTo: getSignUpReturnTo(router.query.returnTo) },
            }}
            className="underline transition text-foreground hover:text-foreground-light"
          >
            Sign up
          </Link>
        </div>
      )}
    </>
  )
}

PlatformSignInPage.getLayout = (page) => (
  <AuthenticationLayout>
    <SignInLayout
      heading="Welcome back"
      subheading="Sign in to your account"
      logoLinkToMarketingSite={true}
      inboundFlow="sign-in"
    >
      {page}
    </SignInLayout>
  </AuthenticationLayout>
)

/**
 * Taskclan Cloud signs people in against its own Supabase project and has none
 * of the platform machinery above: no hCaptcha, no SSO, no identity providers,
 * no sign-up. Upstream's layout is equally wrong for it, carrying Supabase's
 * logo, customer quotes and links to supabase.com's terms.
 *
 * Swapped at the component level rather than with an early return inside one,
 * so neither version calls the other's hooks. Kept at /sign-in rather than a new
 * URL because that is already where `withAuth` and the profile 401 handler send
 * people.
 */
const TaskclanSignInPage: NextPageWithLayout = () => <TaskclanSignInForm />

TaskclanSignInPage.getLayout = (page) => (
  // Geist is the typeface Forge3D and taskclan.com use. Applied here rather
  // than globally: this is a page somebody meets the brand on, where the
  // console behind it is dense UI upstream tuned for Inter.
  <div
    className={`${geistSans.className} flex min-h-screen items-center justify-center bg-studio px-6`}
  >
    <div className="w-full max-w-sm">
      <img
        alt="Taskclan"
        src={`${BASE_PATH}/img/taskclan-mark.svg`}
        className="mb-6 size-10"
        width={40}
        height={40}
      />
      <h1 className="mb-1 text-2xl text-foreground">Sign in to {TASKCLAN_PRODUCT_NAME}</h1>
      <p className="mb-6 text-sm text-foreground-light">
        Manage your apps, deployments and databases.
      </p>
      {page}
    </div>
  </div>
)

const SignInPage = TASKCLAN_AUTH_ENABLED ? TaskclanSignInPage : PlatformSignInPage

export default SignInPage
