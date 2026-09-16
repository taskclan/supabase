import { Geist, Geist_Mono, Manrope } from 'next/font/google'
import localFont from 'next/font/local'

/**
 * Geist, the typeface Forge3D and taskclan.com already use.
 *
 * Scoped to the unauthenticated brand surfaces (sign-in, landing) rather than
 * swapped in globally. Those are the pages a customer meets Taskclan on, so
 * they should look like Taskclan; the console behind them is dense, data-heavy
 * UI that upstream tuned for Inter, and changing the typeface under every table
 * and editor is a separate decision with its own consequences.
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

export const manrope = Manrope({
  variable: '--font-manrope',
  display: 'swap',
  subsets: ['latin'],
})

export const inter = localFont({
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
  src: [
    {
      path: './inter/InterVariable.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: './inter/InterVariable-Italic.woff2',
      weight: '100 900',
      style: 'italic',
    },
  ],
})

export const sourceCodePro = localFont({
  variable: '--font-source-code-pro',
  display: 'swap',
  fallback: ['Source Code Pro', 'Office Code Pro', 'Menlo', 'monospace'],
  src: [
    {
      path: './source-code-pro/SourceCodePro-Variable.woff2',
      weight: '200 900',
      style: 'normal',
    },
    {
      path: './source-code-pro/SourceCodePro-Variable-Italic.woff2',
      weight: '200 900',
      style: 'italic',
    },
  ],
})
