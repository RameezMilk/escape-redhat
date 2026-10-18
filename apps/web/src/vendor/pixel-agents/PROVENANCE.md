# Vendored: Pixel Agents renderer (MIT)

- Source: https://github.com/pixel-agents-hq/pixel-agents
- Pinned commit: `3537e140c2094761beae748592aeb92ece8edfdd` (v1.4.1, committed 2026-08-15 — public > 2 weeks before the
  Oct 17–18 2026 hackathon). Every file copied here is byte-identical between this commit and `b1bafd0` (current main).
- License: MIT, Copyright (c) 2026 Pablo De Lucca — see `LICENSE` in this directory (kept verbatim).
- Art in `apps/web/public/assets/{characters,floors,walls,furniture}` comes from the same commit. Floors/walls/furniture
  were replaced with open assets in upstream PR #117; character sheets are based on JIK-A-4 "Metro City" (CC0).
  Not copied: FS Pixel Sans font (no license file), pets, editor, VS Code/terminal/transport code.

## What we use

Only the pure-TypeScript Canvas 2D renderer: `office/engine/{renderer,characters,gameLoop}.ts`, `office/layout/*`,
`office/sprites/*`, `office/{projection,colorize,floorTiles,wallTiles,types}.ts`, `constants.ts`,
`core/src/assets/*` (PNG/manifest helpers). Our own code lives outside this directory (`apps/web/src/office/*`).
`webview-ui/src/browserMock.ts` is kept for reference only (reworked into `apps/web/src/office/assetLoader.ts`) and is
excluded from type-checking.

## Local patches (search `ESCAPE-PATCH`)

| File | Change | Why |
|---|---|---|
| `office/types.ts` | `Character.scripted?`, `Character.spriteOverride?` | engine-driven characters; Daniel's wheelchair sprite |
| `office/engine/characters.ts` | `updateCharacter`: scripted characters only advance animation frames | the simulation server is authoritative — no ambient wandering/pathing in the renderer |
| `office/engine/officeState.ts` | pass `[]` wander targets | belt-and-braces (we do not use OfficeState) |
| `office/engine/renderer.ts` | `ExtraDrawable[]` param on `renderScene`/`renderFrame`; `ch.spriteOverride ?? …` | z-sorted hazards, signage and the wheelchair sprite |
