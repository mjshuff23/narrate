# 0001 — Toolchain pins

Date: 2026-09-07. Slice 1.

## Context

The build machine's nvm default is Node 26, a Current release, and it has
broken scaffolds before. The delta audit (docs/research) recommended
`typescript@7.0.2` and `vitest@5.0.0` because they were the registry's
`latest` on the research date. The unified/rehype ecosystem and `file-type`
are ESM-only.

## Decision

| Tool          | Pin                            | Note                                                                                                                               |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Node          | 24 (LTS)                       | `.nvmrc` = `24`; `engines.node` = `>=24 <25`; `engine-strict=true`.                                                                |
| Module system | ESM                            | `"type": "module"` everywhere; `NodeNext` resolution, `.js` imports.                                                               |
| pnpm          | 11.17.0                        | `packageManager` field. `allowBuilds` limited to esbuild + hooks.                                                                  |
| TypeScript    | 5.9.3                          | **Not 7.x.**                                                                                                                       |
| Vitest        | 4.1.11                         | **Not 5.x.**                                                                                                                       |
| tsx           | 4.23.13                        | Dev runner for the server (slice 2). Node's native type stripping is not a full TS runtime; Node's own docs point to tsx for that. |
| ESLint        | 10.10.0                        | Flat config, `typescript-eslint` 8.70.0 recommended rules (untyped).                                                               |
| Prettier      | 3.9.6                          | `format:check` is a CI gate.                                                                                                       |
| Hooks         | simple-git-hooks + lint-staged | pre-commit: lint + format staged files; pre-push: typecheck + tests.                                                               |

## Why

- **`.nvmrc` pins the major, not the patch, on purpose.** `24` means every
  developer and CI run gets the current 24.x, which is how Node ships security
  fixes. An exact `24.18.0` would freeze those out until someone opens a PR.
  The lockfile pins the JavaScript dependencies; Node itself floats within the
  LTS line that `engines` enforces. (Slice 1 was verified on 24.18.0.)
- **Node 24 not 26.** Vite 8 declares `^20.19 || >=22.12`; `file-type` and
  `unpdf` declare `>=22`. Node 24 satisfies every engine range and is the
  active LTS line. Node 26 would probably work, but "probably" is what broke
  earlier scaffolds. `engine-strict` turns the pin into a refusal, not a hint.
- **TypeScript 5.9.3 not 7.0.2.** TypeScript 7 is the Go-native compiler,
  released 2026-07-08. On 2026-09-07 `typescript-eslint@8.70.0` declared a
  peer range of `>=4.8.4 <6.1.0`, so linting would fail on install. Boring
  means the ecosystem has caught up, not that the registry says latest.
- **Vitest 4.1.11 not 5.0.0.** Vitest 5 was released 2026-09-03, four days
  before this decision. Same reasoning.
- **pnpm 11 defaults.** pnpm 11 blocks install scripts unless allowed and
  refuses packages younger than a minimum release age. Both are supply-chain
  gates we want. `typescript-eslint@8.70.0` was inside the age window, so
  pnpm wrote an exclusion list into `pnpm-workspace.yaml`; it is annotated
  there and should be removed once the release is older than the window.

## Consequences

- Any contributor on the wrong Node gets a hard error at `pnpm install`.
- TypeScript 7 and Vitest 5 are deliberate future upgrades, each its own PR,
  each gated on peer ranges declaring support.
- All relative imports carry `.js` extensions. tsx and Vitest handle this in
  dev; a future `tsc` build emits runnable output without a rewrite step.
