import { FlaskConical, LogOut, Settings } from 'lucide-react'
import { useTheme } from 'next-themes'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  singleThemes,
} from 'ui'

import { ButtonTooltip } from '../ui/ButtonTooltip'
import { useFeaturePreviewModal } from './App/FeaturePreview/FeaturePreviewContext'
import { DevToolbarMenuGroup } from './DevToolbarMenuGroup'
import { ProfileImage } from '@/components/ui/ProfileImage'
import { TASKCLAN_AUTH_ENABLED } from '@/lib/constants'
import { useProfile } from '@/lib/profile'
import { useTrack } from '@/lib/telemetry/track'
import { useAppStateSnapshot } from '@/state/app-state'

export const LocalDropdown = ({
  triggerClassName,
  contentClassName,
}: {
  triggerClassName?: string
  contentClassName?: string
}) => {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const appStateSnapshot = useAppStateSnapshot()
  const { toggleFeaturePreviewModal } = useFeaturePreviewModal()
  const track = useTrack()
  const { profile } = useProfile()

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) track('header_local_dropdown_opened')
      }}
    >
      <DropdownMenuTrigger className={cn('border shrink-0 px-3', triggerClassName)} asChild>
        <ButtonTooltip
          className="[&>span]:flex px-0 py-0 rounded-full overflow-hidden h-8 w-8"
          tooltip={{ content: { text: 'Settings' } }}
        >
          <ProfileImage className="w-8 h-8 rounded-md" />
          <span className="sr-only">Settings</span>
        </ButtonTooltip>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className={cn('w-44', contentClassName)}>
        <DropdownMenuItem className="flex gap-2 cursor-pointer" asChild>
          <Link
            href="/account/me"
            onClick={() => {
              if (router.pathname !== '/account/me') {
                appStateSnapshot.setLastRouteBeforeVisitingAccountPage(router.asPath)
              }
            }}
          >
            <Settings size={14} strokeWidth={1.5} className="text-foreground-lighter" />
            Preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex gap-2 cursor-pointer"
          onClick={() => toggleFeaturePreviewModal(true)}
          onSelect={() => toggleFeaturePreviewModal(true)}
        >
          <FlaskConical size={14} strokeWidth={1.5} className="text-foreground-lighter" />
          Feature previews
        </DropdownMenuItem>
        {/* Who you are, and how to stop being them.
          *
          * This console renders LocalDropdown rather than UserDropdown, because
          * that choice is made on IS_PLATFORM, which is false in this build.
          * UserDropdown owns the only Sign out in the app and gates it on the
          * same flag, so with Taskclan auth switched on there was a real login
          * and no visible way out of it. Adding it here rather than flipping
          * either guard: IS_PLATFORM turns on a great deal more than a menu
          * item. */}
        {TASKCLAN_AUTH_ENABLED && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {!!profile?.primary_email && (
                <DropdownMenuLabel className="font-normal text-foreground-lighter truncate">
                  {profile.primary_email}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem
                className="flex gap-2 cursor-pointer"
                onSelect={() => router.push('/logout')}
              >
                <LogOut size={14} strokeWidth={1.5} className="text-foreground-lighter" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DevToolbarMenuGroup />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              setTheme(value)
            }}
          >
            {singleThemes.map((theme) => (
              <DropdownMenuRadioItem
                key={theme.value}
                value={theme.value}
                className="cursor-pointer"
              >
                {theme.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
