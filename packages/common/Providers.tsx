'use client'

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      themes={['dark', 'light', 'classic-dark']}
      // Dark, not system. The comp (Taskclan Cloud v2.dc.html) ships dark as
      // its default, and 'system' meant anyone whose OS is set to light saw
      // the light theme before they had chosen anything. Both themes are
      // Sitterly now, so this is a preference rather than a brand decision —
      // enableSystem stays on, so picking System still follows the OS.
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
