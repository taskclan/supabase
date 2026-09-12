export interface SingleTheme {
  name: string
  value: string
}

export const singleThemes = [
  { name: 'System', value: 'system' }, // Classic Supabase light
  { name: 'Dark', value: 'dark' }, // Classic Supabase dark
  { name: 'Light', value: 'light' }, // Classic Supabase light
  { name: 'Classic Dark', value: 'classic-dark' }, // Deep Dark Supabase dark
  // Taskclan Cloud (Sitterly). Appended rather than replacing the upstream
  // entries so a rebase does not conflict and the Supabase themes stay
  // available for comparing a screen against its original.
  { name: 'Taskclan Dark', value: 'taskclan-dark' },
  { name: 'Taskclan Light', value: 'taskclan-light' },
]
