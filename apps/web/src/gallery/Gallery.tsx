// ?gallery=1 — every procedural sprite (custom furniture, decor, derived character outfits) at 4×, for visual review.
import { useEffect, useState } from 'react';

import { Direction } from '../vendor/pixel-agents/webview-ui/src/office/types';
import { getCharacterSprites } from '../vendor/pixel-agents/webview-ui/src/office/sprites/spriteData';
import { loadPixelAssets } from '../office/assetLoader';
import { KENJI_PALETTE, ROSA_PALETTE } from '../office/sprites/characters';
import { getDecorSprites } from '../office/sprites/decor';
import { getCustomFurnitureSprites } from '../office/sprites/furniture';
import type { SpriteData } from '../office/sprites/raster';

const SCALE = 4;

function SpriteCanvas({ sprite, label }: { sprite: SpriteData; label: string }) {
  return (
    <figure className="gallery-item">
      <canvas
        width={sprite[0].length * SCALE}
        height={sprite.length * SCALE}
        ref={(c) => {
          const ctx = c?.getContext('2d');
          if (!ctx) return;
          ctx.clearRect(0, 0, c!.width, c!.height);
          sprite.forEach((row, y) =>
            row.forEach((px, x) => {
              if (!px) return;
              ctx.fillStyle = px;
              ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
            }),
          );
        }}
      />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function Gallery() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadPixelAssets().then(() => setReady(true));
  }, []);
  if (!ready) return <div className="gallery">Loading sprites…</div>;
  const furniture = getCustomFurnitureSprites();
  const decor = getDecorSprites();
  const people: [string, number][] = [
    ['Kenji (palette 6)', KENJI_PALETTE],
    ['Rosa (palette 7)', ROSA_PALETTE],
    ['char_2 (source)', 2],
    ['char_1 (source)', 1],
  ];
  return (
    <div className="gallery">
      <h2>Furniture</h2>
      <div className="gallery-row">
        {Object.entries(furniture).map(([id, s]) => (
          <SpriteCanvas key={id} sprite={s} label={id} />
        ))}
      </div>
      <h2>Decor</h2>
      <div className="gallery-row">
        {Object.entries(decor).map(([id, s]) => (
          <SpriteCanvas key={id} sprite={s} label={id} />
        ))}
      </div>
      <h2>People</h2>
      <div className="gallery-row">
        {people.flatMap(([label, palette]) => {
          const s = getCharacterSprites(palette);
          return [
            <SpriteCanvas key={`${label}-down`} sprite={s.walk[Direction.DOWN][1]} label={`${label} · down`} />,
            <SpriteCanvas key={`${label}-type`} sprite={s.typing[Direction.DOWN][0]} label={`${label} · typing`} />,
            <SpriteCanvas key={`${label}-right`} sprite={s.walk[Direction.RIGHT][0]} label={`${label} · right`} />,
            <SpriteCanvas key={`${label}-up`} sprite={s.walk[Direction.UP][0]} label={`${label} · up`} />,
          ];
        })}
      </div>
    </div>
  );
}
