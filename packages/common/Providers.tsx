'use client'

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      themes={['dark', 'light', 'classic-dark']}
      // Light (the taskclan.com cream) is the default face of the product, to
      // match the marketing site. enableSystem stays on, so picking System still
      // follows the OS and dark remains one tap away — this is a preference, not
      // a brand decision, since both themes are the Taskclan palette now.
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
