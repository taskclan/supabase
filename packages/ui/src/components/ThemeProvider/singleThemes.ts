export interface SingleTheme {
  name: string
  value: string
}

export const singleThemes = [
  { name: 'System', value: 'system' }, // follows the OS, resolving to one of the two below
  { name: 'Dark', value: 'dark' }, // Sitterly dark — see the note below
  { name: 'Light', value: 'light' }, // Sitterly light
  // 'Classic Dark' is upstream's Supabase palette, kept for comparing a screen
  // against its original. Not offered in the picker: a Taskclan product should
  // not present someone else's brand as a choice. The CSS still loads, so
  // setting data-theme="classic-dark" by hand still works.
]

/**
 * Note on 'dark' and 'light': these now resolve to Sitterly, not Supabase.
 * See packages/ui/build/css/themes/taskclan-dark.css — those files claim the
 * plain selectors so Taskclan theming is the default rather than something a
 * viewer has to opt into. The picker needs no Taskclan-specific entries as a
 * result; 'Dark' IS Taskclan Dark.
 */
