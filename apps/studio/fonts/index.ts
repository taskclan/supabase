import { Geist, Geist_Mono } from 'next/font/google'

/**
 * Geist — the typeface taskclan.com and Forge3D use — is the console's global
 * font. It is applied to <body> in pages/_document.tsx (variable classes) and
 * mapped to --font-sans / --font-heading / --font-source-code-pro by the inline
 * :root <style> in pages/_app.tsx (the Vite/TanStack build mirrors this in
 * styles/fonts.css). Brand surfaces (sign-in, landing, cloud/device) also use
 * geistSans.className directly.
 */
export const geistSans = Geist({
  variable: '--font-geist-sans',
  display: 'swap',
  subsets: ['latin'],
})

export const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  display: 'swap',
  subsets: ['latin'],
})
