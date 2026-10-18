// Character outfits derived at load time from the vendored Metro City sheets (CC0, via Pixel Agents) by exact-colour
// recolouring, appended after the stock sheets as new palette indices:
//   KENJI_PALETTE — char_2 (dark skin, afro) with the shirt in NVIDIA greens, a black jacket and a small logo print.
//   ROSA_PALETTE  — char_1 (long brown hair) with the black outfit turned into a Red Hat red blazer.
import type { CharacterDirectionSprites } from '../../vendor/pixel-agents/core/src/assets/types';

export const KENJI_PALETTE = 6;
export const ROSA_PALETTE = 7;

const KENJI_SOURCE = 2;
const ROSA_SOURCE = 1;
const NV_GREEN = '#76B900';

const KENJI_COLOURS: Record<string, string> = {
  '#8B1A16': NV_GREEN, // shirt
  '#A91D18': '#8ED100', // shirt highlight
  '#741713': '#5E9400', // shirt shade
  '#56110E': '#3F6400', // shirt outline
  '#F67D20': '#1E1E1E', // orange jacket → black (front trim, back and sides)
  '#E1721D': '#2A2A2A',
  '#E8741B': '#2A2A2A',
  '#E87218': '#262626',
  '#FF8B31': '#3A3A3A', // jacket highlight
  '#592700': '#141414', // jacket shade
};

const ROSA_COLOURS: Record<string, string> = {
  '#252525': '#C4161C', // outfit → Red Hat red blazer
  '#2B2B2B': '#A3121A',
  '#1A1A1A': '#7D0D13',
};

type Frame = string[][];

const recolourFrame = (f: Frame, map: Record<string, string>): Frame => f.map((row) => row.map((px) => map[px.toUpperCase()] ?? px));

/** A two-pixel white print on the green shirt, centred on the chest of a down-facing frame. */
function stampBadge(f: Frame): Frame {
  const out = f.map((r) => [...r]);
  const cx = Math.floor(out[0].length / 2) - 1;
  const y = out.findIndex((row) => row[cx] === NV_GREEN && row[cx + 1] === NV_GREEN);
  if (y >= 0 && y + 1 < out.length && out[y + 1][cx] === NV_GREEN) {
    out[y + 1][cx] = '#FFFFFF';
    out[y + 1][cx + 1] = '#FFFFFF';
  }
  return out;
}

function derive(base: CharacterDirectionSprites, map: Record<string, string>, badge = false): CharacterDirectionSprites {
  const down = base.down.map((f) => recolourFrame(f, map));
  return {
    down: badge ? down.map(stampBadge) : down,
    up: base.up.map((f) => recolourFrame(f, map)),
    right: base.right.map((f) => recolourFrame(f, map)),
  };
}

/** The stock sheets plus the derived outfits, in palette order. */
export function withDerivedOutfits(sheets: CharacterDirectionSprites[]): CharacterDirectionSprites[] {
  if (sheets.length !== KENJI_PALETTE) throw new Error(`expected ${KENJI_PALETTE} stock character sheets, got ${sheets.length}`);
  return [...sheets, derive(sheets[KENJI_SOURCE], KENJI_COLOURS, true), derive(sheets[ROSA_SOURCE], ROSA_COLOURS)];
}
