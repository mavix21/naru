# Anti-slop vendoring

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), bundled in this repository's `.agents/skills/install-anti-slop/assets/anti-slop/` skill assets (see `skills-lock.json`). The exact upstream commit for these plugin assets is unknown; the skill lock hash does not identify a source commit. The copied `index.ts` has SHA-256 `9deed4cb455b9a6251001dc3a525d5b5e2c6ef989dd1c01e804c2edf0a697415`.

Installed plugin paths: `tools/oxlint/anti-slop/index.ts` and `tools/oxlint/anti-slop/effect/index.ts`, with their supporting `rules/`, `effect/`, and `vendor/` files. The generic plugin is registered in the repository's root Oxlint configuration; the Effect plugin is not enabled because no workspace declares a direct `effect` dependency. The bundled ESLint Stylistic license and its source commit/adaptations are retained in `vendor/eslint-stylistic/`.

Local deviations from the bundled assets: this provenance record and `package.json`, which marks the vendored TypeScript plugin as an ES module so Node does not emit module-type warnings when Oxlint loads it. All other files were copied unchanged from the bundled skill assets.
