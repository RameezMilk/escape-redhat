# Third-party notices

## Pixel Agents: renderer code and pixel-art assets (MIT)

- **Source:** https://github.com/pixel-agents-hq/pixel-agents, commit `3537e140c2094761beae748592aeb92ece8edfdd` (v1.4.1).
- **Publication date:** 2026-08-15. That is more than two weeks before the event, so it satisfies the hackathon's reuse rule. The files we copied are byte-identical at current `main`.
- **License:** MIT, Copyright (c) 2026 Pablo De Lucca. The full text is at `apps/web/src/vendor/pixel-agents/LICENSE`.
- **How we use it:** we extracted only the Canvas 2D renderer, office/sprite engine and assets. Local modifications are marked `// ESCAPE-PATCH` (`git log -p apps/web/src/vendor` shows every change). We did not reuse the VS Code extension, Claude Code hooks, transport, server, editor or fonts.

**Vendored source files**, under `apps/web/src/vendor/pixel-agents/`:

```
LICENSE
core/src/paletteUtils.ts
core/src/assets/{build,colorUtils,constants,loader,manifestUtils,pngDecoder,types}.ts
webview-ui/src/browserMock.ts
webview-ui/src/constants.ts
webview-ui/src/components/ui/types.ts
webview-ui/src/office/{colorize,floorTiles,projection,toolUtils,types,wallTiles}.ts
webview-ui/src/office/engine/{characters,existingAgents,gameLoop,index,matrixEffect,matrixEffectState,officeState,petEntity,renderer,seatPlacement}.ts
webview-ui/src/office/layout/{exportLayout,furnitureCatalog,index,layoutSerializer,tileMap}.ts
webview-ui/src/office/sprites/{carpetTiles,index,petSpriteData,spriteCache,spriteData}.ts
webview-ui/src/office/sprites/bubble-{permission,pet,waiting}.json
```

**Vendored assets**, under `apps/web/public/assets/`:
- `characters/char_0..5.png`
- `floors/floor_0..8.png`
- `walls/wall_0.png`
- `furniture/*` (25 items: BIN, BOOKSHELF, CACTUS, CLOCK, COFFEE, COFFEE_TABLE, CUSHIONED_BENCH, CUSHIONED_CHAIR, DESK, DOUBLE_BOOKSHELF, HANGING_PLANT, LARGE_PAINTING, LARGE_PLANT, PC, PLANT, PLANT_2, POT, SMALL_PAINTING, SMALL_PAINTING_2, SMALL_TABLE, SOFA, TABLE_FRONT, WHITEBOARD, WOODEN_BENCH, WOODEN_CHAIR)

`asset-index.json` and `furniture-catalog.json` are generated from those manifests.

**Asset provenance** (as stated by the upstream project):
- **Character sprites.** The Pixel Agents README says they are "based on the amazing work of JIK-A-4, Metro City". The Metro City pack's itch.io page lists it as CC0 1.0. Credit to JIK-A-4 anyway.
- **Floors, walls and furniture.** Added in Pixel Agents PR #117 (v1.1.0, merged 2026-03-13). The PR states it replaced all previously privately-licensed assets with open-source ones tracked in the repository, so they are distributed under the repository's MIT license. That they fall under MIT is our reading of the PR, and we have not seen a separate per-asset license file.
- **Not shipped.** We do not ship the upstream FS Pixel Sans font (no license file found) or the pet sprites.

## Original art made for this project (MIT, this repo)

These were authored here, as code-defined pixel sprites:
- Daniel's wheelchair sprite;
- the animated fire, charred floor, sliding doors, sparks and fire-alarm pull stations;
- the "RED HAT", "NVIDIA", "WELCOME" and "FIRE WARDEN" pixel signs, EXIT signs, evacuation plans, the assembly flag and
  the bus-stop sign;
- the ground-floor furniture: GPU racks (with blinking LEDs), cubicles, the reception desk, the kitchen counter,
  fridge, vending machine, coffee machine and bus shelter, plus the road markings (`apps/web/src/office/sprites/`).

Two character outfits are recoloured at load time from the Metro City sheets above (exact-colour swaps, CC0 source):
Kenji (from `char_2`: NVIDIA-green shirt, black jacket, small logo print) and Rosa (from `char_1`: red blazer).

The GPU server-room sign and Kenji's shirt print include a small hand-drawn pixel rendition of the **NVIDIA eye
logo**. It is NVIDIA trademark artwork, drawn at the team's request as set dressing for this hackathon-themed office;
see Trademarks below.

## Fonts (SIL Open Font License 1.1)

Inter, Pixelify Sans and Press Start 2P (start-screen title), all via `@fontsource` npm packages.

## Safety knowledge pack

`data/knowledge/` paraphrases and links:
- U.S. federal OSHA regulations (29 CFR 1910.36, 1910.37, 1910.38, 1910.165). U.S. government works; not copyrighted.
- OSHA's *Emergency Preparedness: Getting Started* guidance.
- North Carolina Department of Labor pages. Cited for context only, with source URLs.

This is not legal advice and makes no compliance claim.

## Software dependencies

Installed from npm under each package's own license; see `package-lock.json`. All were resolved with `before=2026-10-03` (`.npmrc`).

The model is not redistributed here. NVIDIA Nemotron 3.5 Lightning 30B-A3B is downloaded at deploy time from Hugging Face under its own license (OpenMDW-1.1, per the model card).

## Trademarks

"Red Hat" and "NVIDIA" are trademarks of their respective owners. This is a fictional, hackathon-themed office created for the NVIDIA × Red Hat Small Models Hack. It is not affiliated with, sponsored by, or endorsed by Red Hat or NVIDIA. It is not a real building, and it is not an official training product.
