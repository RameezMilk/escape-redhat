// Furniture drawn procedurally for Escape from Red Hat (no PNGs): footprints shared by the map builder (navigation
// truth: which tiles each item blocks) and the web catalog (rendering). Sprites live in apps/web/src/office/sprites/
// furniture.ts and must match these sizes. Conventions follow the Pixel Agents catalog: the sprite is drawn from the
// item's top-left tile; the first `backgroundTiles` rows are walkable (drawn behind people standing there).
export interface CustomFurnitureDef {
  label: string;
  category: 'desks' | 'electronics' | 'storage' | 'misc' | 'decor';
  /** Sprite size in pixels (width = footprintW × 16 and height = footprintH × 16). */
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  backgroundTiles: number;
  /** Surface items (PCs, the coffee machine) may sit on desks. */
  isDesk: boolean;
  canPlaceOnSurfaces?: boolean;
}

export const CUSTOM_FURNITURE = {
  GPU_RACK: { label: 'GPU server rack', category: 'electronics', width: 32, height: 32, footprintW: 2, footprintH: 2, backgroundTiles: 0, isDesk: false },
  CUBICLE: { label: 'Cubicle workstation', category: 'desks', width: 48, height: 32, footprintW: 3, footprintH: 2, backgroundTiles: 1, isDesk: true },
  RECEPTION_DESK: { label: 'Reception desk', category: 'desks', width: 64, height: 32, footprintW: 4, footprintH: 2, backgroundTiles: 1, isDesk: true },
  KITCHEN_COUNTER: { label: 'Kitchen counter', category: 'desks', width: 64, height: 32, footprintW: 4, footprintH: 2, backgroundTiles: 1, isDesk: true },
  FRIDGE: { label: 'Fridge', category: 'storage', width: 16, height: 32, footprintW: 1, footprintH: 2, backgroundTiles: 0, isDesk: false },
  VENDING_MACHINE: { label: 'Vending machine', category: 'storage', width: 16, height: 32, footprintW: 1, footprintH: 2, backgroundTiles: 0, isDesk: false },
  COFFEE_MACHINE: { label: 'Coffee machine', category: 'misc', width: 16, height: 16, footprintW: 1, footprintH: 1, backgroundTiles: 0, isDesk: false, canPlaceOnSurfaces: true },
  BUS_SHELTER: { label: 'Bus shelter', category: 'decor', width: 80, height: 32, footprintW: 5, footprintH: 2, backgroundTiles: 1, isDesk: false },
} as const satisfies Record<string, CustomFurnitureDef>;

export type CustomFurnitureId = keyof typeof CUSTOM_FURNITURE;
