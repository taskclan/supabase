# Forge3D (Sitterly) tokens

The Taskclan design system's own token names — `--color-primary`, `--space-md`,
`--radius-lg`, `--shadow-card`, `--gradient-hero` — copied from the Claude Design
project `forge3d-design-tokens` so that Taskclan-authored components inside
Studio can use the same names as the rest of Taskclan (the engine console,
forge3D, the marketing sites) instead of a second vocabulary.

This is **additive and separate** from `../themes/taskclan-*.css`. Those express
Sitterly through Studio's own OKLCH machinery, which is what re-skins the 4,600
upstream components. These are for code *we* write.

Two adaptations from the source files, both necessary:

1. **Selectors.** Upstream Forge3D keys dark on `[data-theme='dark']`. Studio's
   theme attribute carries `taskclan-dark` / `taskclan-light`, so each block
   gained the matching selector — otherwise the dark palette never fires here
   and every token silently stays light.
2. **`stage.css` is not copied.** It styles Forge3D's 3D viewport canvas
   (`--stage-bg` and friends). A Postgres console has no viewport; shipping it
   would be vocabulary nobody can use.

Typography keeps the `@import` of Figtree from Google Fonts, since Studio has no
next/font pipeline for this package the way `apps/cloud` does in the engine.

To re-sync: pull the files from the design project again and re-apply the two
adaptations above.
