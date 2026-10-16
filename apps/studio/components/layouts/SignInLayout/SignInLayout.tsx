import { useQueryClient } from '@tanstack/react-query'
import { getAccessToken, useFlag } from 'common'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { PropsWithChildren, useEffect, useState } from 'react'
import { cn } from 'ui'

import {
  DestinationLogo,
  InterstitialLayout,
  LogoPair,
  SupabaseLogo,
} from '@/components/layouts/InterstitialLayout'
import { DocsButton } from '@/components/ui/DocsButton'
import { InlineLink } from '@/components/ui/InlineLink'
import { IdentityProviderIcon } from '@/components/ui/ProviderIcon'
import { useCustomContent } from '@/hooks/custom-content/useCustomContent'
import { useInboundBranding } from '@/hooks/misc/useInboundBranding'
import { useIsFeatureEnabled } from '@/hooks/misc/useIsFeatureEnabled'
import { BASE_PATH, DOCS_URL } from '@/lib/constants'
import { getProviderDisplay } from '@/lib/external-identity-providers'
import { auth, buildPathWithParams, getReturnToPath } from '@/lib/gotrue'

type SignInLayoutProps = {
  heading: string
  subheading: string
  showDisclaimer?: boolean
  logoLinkToMarketingSite?: boolean
  /**
   * When set, the layout can show a focused-provider interstitial or swap its default heading for
   * a destination-branded header (see {@link useInboundBranding}). The flow controls the verb
   * ("Sign in" vs "Sign up").
   */
  inboundFlow?: 'sign-in' | 'sign-up'
}

const TermsText = () => (
  <>
    By continuing, you agree to Taskclan’s{' '}
    <InlineLink href="https://www.taskclan.com/terms">Terms of Service</InlineLink> and{' '}
    <InlineLink href="https://www.taskclan.com/privacy">Privacy Policy</InlineLink>, and to receive
    periodic emails with updates.
  </>
)

export const SignInLayout = ({
  heading,
  subheading,
  showDisclaimer = true,
  logoLinkToMarketingSite = false,
  inboundFlow,
  children,
}: PropsWithChildren<SignInLayoutProps>) => {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const queryClient = useQueryClient()
  const ongoingIncident = useFlag('ongoingIncident')

  const { destination, focusProvider } = useInboundBranding(inboundFlow)
  const { dashboardAuthLogoLinkUrl } = useCustomContent(['dashboard_auth:logo_link_url'])
  const marketingSiteUrl = dashboardAuthLogoLinkUrl ?? 'https://www.taskclan.com'

  // Addresses hydration issue with `resolvedTheme` as its undefined during SSR and the first (hydrating) client render
  const [mounted, setMounted] = useState(false)

  const verb = inboundFlow === 'sign-up' ? 'Sign up' : 'Sign in'

  const { brandingLargeLogo: largeLogo, dashboardAuthShowTos: showTos } = useIsFeatureEnabled([
    'branding:large_logo',
    'dashboard_auth:show_tos',
  ])

  // This useEffect redirects the user to MFA if they're already halfway signed in
  useEffect(() => {
    auth
      .initialize()
      .then(async ({ error }) => {
        if (error) {
          // if there was a problem signing in via the url, don't redirect
          return
        }

        const token = await getAccessToken()

        if (token) {
          const { data, error } = await auth.mfa.getAuthenticatorAssuranceLevel()
          if (error) {
            // if there was a problem signing in via the url, don't redirect
            return
          }

          if (data) {
            // we're already where we need to be
            if (router.pathname === '/sign-in-mfa') {
              return
            }
            if (data.currentLevel !== data.nextLevel) {
              const redirectTo = buildPathWithParams('/sign-in-mfa')
              router.replace(redirectTo)
              return
            }
          }

          await queryClient.resetQueries()
          router.push(getReturnToPath())
        }
      })
      .catch(() => {}) // catch all errors thrown by auth methods
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  // Focused provider: render a dedicated single-provider interstitial (same card layout as the
  // external-identity flows). When we also know the destination the inbound link is returning the
  // user to, frame the screen around it.
  if (inboundFlow && focusProvider) {
    return (
      <InterstitialLayout
        logo={
          <LogoPair
            left={
              <DestinationLogo
                icon={
                  destination?.icon ?? (
                    <IdentityProviderIcon
                      display={getProviderDisplay(focusProvider.id)}
                      size={28}
                    />
                  )
                }
                name={destination?.displayName ?? focusProvider.displayName}
              />
            }
            right={<SupabaseLogo />}
          />
        }
        title={destination ? `Continue to ${destination.displayName}` : `${verb} to Taskclan Cloud`}
        description={
          destination
            ? `${verb} to Taskclan Cloud using your ${focusProvider.displayName} account`
            : `Use your ${focusProvider.displayName} account to continue`
        }
        footer={
          showDisclaimer && showTos ? (
            <p className="text-xs text-foreground-lighter">
              <TermsText />
            </p>
          ) : undefined
        }
      >
        <div className="px-6 pb-6">{children}</div>
      </InterstitialLayout>
    )
  }

  // Destination known but no focused provider: keep the regular screen but brand its heading.
  const brandedDestination = inboundFlow ? destination : undefined
  const brandedHeading = brandedDestination
    ? `${verb} to continue to ${brandedDestination.displayName}`
    : undefined

  return (
    <>
      <div
        className="relative flex flex-col min-h-screen overflow-hidden"
        style={{ background: 'var(--gradient-hero)' }}
      >
        {/* taskclan.com hero backdrop: cream->lilac canvas + a soft violet glow (theme-adaptive). */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-40 right-[-8%] h-[640px] w-[640px] rounded-full"
          style={{ background: 'var(--color-primary)', opacity: 0.18, filter: 'blur(150px)' }}
        />
        <div
          className={cn(
            'absolute top-0 w-full px-8 mx-auto sm:px-6 lg:px-8',
            ongoingIncident ? 'mt-14' : 'mt-6'
          )}
        >
          <nav className="relative flex items-center justify-between sm:h-10">
            <div className="flex items-center grow shrink-0 lg:grow-0">
              <div className="flex items-center justify-between w-full md:w-auto">
                <Link href={logoLinkToMarketingSite ? marketingSiteUrl : '/organizations'}>
                  <img
                    src={
                      mounted && resolvedTheme?.includes('dark')
                        ? `${BASE_PATH}/img/taskclan-wordmark.svg`
                        : `${BASE_PATH}/img/taskclan-wordmark.svg`
                    }
                    alt="Taskclan Cloud"
                    className={largeLogo ? 'h-[48px]' : 'h-[24px]'}
                  />
                </Link>
              </div>
            </div>

            <div className="items-center hidden space-x-3 md:ml-10 md:flex md:pr-4">
              <DocsButton abbrev={false} href={`${DOCS_URL}`} />
            </div>
          </nav>
        </div>

        <div className="flex flex-1 h-full">
          <main className="flex flex-col items-center flex-1 shrink-0 px-5 pt-16 pb-8 border-r shadow-lg bg-studio border-default">
            <div className="flex-1 flex flex-col justify-center w-[330px] sm:w-[384px]">
              {brandedDestination ? (
                <div className="mb-10 flex flex-col items-center gap-5 text-center">
                  <LogoPair
                    left={
                      <DestinationLogo
                        icon={brandedDestination.icon}
                        name={brandedDestination.displayName}
                      />
                    }
                    right={<SupabaseLogo />}
                  />
                  <h1 className="text-balance lg:text-2xl">{brandedHeading}</h1>
                </div>
              ) : (
                <div className="mb-10">
                  <h1 className="mt-8 mb-2 lg:text-3xl">{heading}</h1>
                  <h2 className="text-sm text-foreground-light">{subheading}</h2>
                </div>
              )}

              {children}
            </div>

            {showDisclaimer && showTos && (
              <div className="text-center text-balance">
                <p className="text-xs text-foreground-lighter sm:mx-auto sm:max-w-sm">
                  <TermsText />
                </p>
              </div>
            )}
          </main>

          <aside className="flex-col items-center justify-center flex-1 shrink hidden basis-1/4 xl:flex">
            <div className="relative flex max-w-md flex-col gap-4 px-8">
              <h2
                className="text-4xl text-foreground"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.05,
                }}
              >
                Ship a repository to a URL.
              </h2>
              <p className="text-base text-foreground-light">
                Apps, agents and models on one deploy path — built, hosted and run on Taskclan Cloud.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
