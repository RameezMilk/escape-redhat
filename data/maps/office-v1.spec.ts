// office-v1: the original hackathon floor — north corridor, Red Hat room, NVIDIA lobby, south branch, two exits.
// Legend: '#' wall · '.' floor · ',' outdoor walkable · 'A'/'B' conference doors · 'C' lobby connector
//         'W'/'E' exits · 'X' assembly area · ' ' void
import { TILE, type MapSpec } from './builder.js';

const CORRIDOR = { h: 215, s: 12, b: -8, c: -35 };
const EXIT = { h: 140, s: 60, b: -12, c: -25 };
const PAVING = { h: 36, s: 22, b: -22, c: -55 };

const spec: MapSpec = {
  id: 'office-v1',
  version: 1,
  ascii: 'office-v1.ascii',
  legend: {
    '#': { terrain: 'wall', zone: null },
    ' ': { terrain: 'void', zone: null },
    '.': { terrain: 'floor', zone: 'rect' },
    ',': { terrain: 'outdoor', zone: 'rect' },
    W: { terrain: 'floor', zone: 'west_exit' },
    E: { terrain: 'floor', zone: 'east_exit' },
    A: { terrain: 'floor', zone: 'door_a' },
    B: { terrain: 'floor', zone: 'door_b' },
    C: { terrain: 'floor', zone: 'connector' },
    X: { terrain: 'outdoor', zone: 'assembly' },
  },
  rects: [
    { zone: 'north_corridor', cols: [4, 29], rows: [1, 3] },
    { zone: 'rh_room', cols: [4, 17], rows: [5, 17] },
    { zone: 'lobby', cols: [19, 32], rows: [5, 13] },
    { zone: 'south_branch', cols: [26, 27], rows: [14, 17] },
    { zone: 'west_sidewalk', cols: [0, 2], rows: [0, 18] },
    { zone: 'plaza', cols: [19, 24], rows: [15, 18] },
    { zone: 'plaza', cols: [29, 33], rows: [15, 18] },
    { zone: 'plaza', cols: [0, 33], rows: [19, 22] },
  ],
  zones: [
    { id: 'rh_room', label: 'Red Hat conference room', name: 'the Red Hat room', at: 'in the Red Hat room', kind: 'room', hazardPlaceable: true, anchor: { col: 11, row: 13 } },
    { id: 'door_a', label: 'Conference door A (north)', name: 'door A', at: 'at door A', kind: 'door', hazardPlaceable: true, anchor: { col: 8, row: 4 } },
    { id: 'door_b', label: 'Conference door B (east)', name: 'door B', at: 'at door B', kind: 'door', hazardPlaceable: true, anchor: { col: 18, row: 9 } },
    { id: 'north_corridor', label: 'North corridor', name: 'the north hallway', at: 'in the north hallway', kind: 'corridor', hazardPlaceable: true, anchor: { col: 16, row: 2 } },
    { id: 'connector', label: 'Lobby connector (to north corridor)', name: 'the lobby connector', at: 'in the lobby connector', kind: 'door', hazardPlaceable: true, anchor: { col: 27, row: 4 } },
    { id: 'lobby', label: 'NVIDIA lobby', name: 'the NVIDIA lobby', at: 'in the NVIDIA lobby', kind: 'room', hazardPlaceable: true, anchor: { col: 25, row: 10 } },
    { id: 'south_branch', label: 'South branch (to east exit)', name: 'the south corridor', at: 'in the south corridor', kind: 'corridor', hazardPlaceable: true, anchor: { col: 26, row: 16 } },
    { id: 'west_exit', label: 'West exit', name: 'the west exit', at: 'at the west exit', kind: 'exit', hazardPlaceable: false, anchor: { col: 3, row: 1 } },
    { id: 'east_exit', label: 'East exit', name: 'the east exit', at: 'at the east exit', kind: 'exit', hazardPlaceable: false, anchor: { col: 26, row: 18 } },
    { id: 'west_sidewalk', label: 'West sidewalk (outside)', name: 'outside', at: 'outside', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 1, row: 10 } },
    { id: 'plaza', label: 'South plaza (outside)', name: 'outside', at: 'outside', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 22, row: 20 } },
    { id: 'assembly', label: 'Assembly / check-in point', name: 'the assembly point', at: 'at the assembly point', kind: 'assembly', hazardPlaceable: false, anchor: { col: 15, row: 20 } },
  ],
  // Pixel Agents catalog ids. Chairs are walkable (people sit on them). Keep corridors clear: furniture there would
  // break wheelchair clearance on the alternate route.
  furniture: [
    // Red Hat room — conference table with chairs
    { type: 'TABLE_FRONT', col: 9, row: 8 },
    { type: 'WOODEN_CHAIR_SIDE', col: 8, row: 8 },
    { type: 'WOODEN_CHAIR_SIDE', col: 8, row: 10 },
    { type: 'WOODEN_CHAIR_SIDE:left', col: 12, row: 8 },
    { type: 'WOODEN_CHAIR_SIDE:left', col: 12, row: 10 },
    // Bookshelf that leaves a deliberate 1-wide gap (col 8) beside the table: walkable, NOT wheelchair-accessible
    { type: 'DOUBLE_BOOKSHELF', col: 6, row: 10 },
    // Maya's workstation near door A
    { type: 'DESK_FRONT', col: 12, row: 5 },
    { type: 'PC_FRONT_ON_1', col: 13, row: 5 },
    { type: 'WOODEN_CHAIR_BACK', col: 13, row: 6 },
    // Two workstations along the south wall
    { type: 'DESK_FRONT', col: 5, row: 14 },
    { type: 'PC_FRONT_ON_1', col: 6, row: 14 },
    { type: 'WOODEN_CHAIR_BACK', col: 6, row: 15 },
    { type: 'DESK_FRONT', col: 13, row: 14 },
    { type: 'PC_FRONT_ON_1', col: 14, row: 14 },
    { type: 'WOODEN_CHAIR_BACK', col: 14, row: 15 },
    // Room decor
    { type: 'PLANT', col: 4, row: 5 },
    { type: 'LARGE_PLANT', col: 16, row: 5 },
    { type: 'PLANT_2', col: 17, row: 15 },
    { type: 'BIN', col: 4, row: 13 },
    // NVIDIA lobby — warden desk
    { type: 'DESK_FRONT', col: 21, row: 6 },
    { type: 'PC_FRONT_ON_1', col: 22, row: 6 },
    { type: 'WOODEN_CHAIR_BACK', col: 22, row: 7 },
    // Lounge
    { type: 'SOFA_FRONT', col: 29, row: 9 },
    { type: 'COFFEE_TABLE', col: 29, row: 10 },
    { type: 'LARGE_PLANT', col: 31, row: 5 },
    { type: 'PLANT', col: 19, row: 11 },
    { type: 'CACTUS', col: 32, row: 11 },
  ],
  decor: [
    { kind: 'sign_redhat', col: 12, row: 4, label: 'RED HAT' },
    { kind: 'sign_nvidia', col: 21, row: 4, label: 'NVIDIA' },
    { kind: 'exit_sign', col: 3, row: 3, label: 'EXIT' },
    { kind: 'exit_sign', col: 28, row: 14, label: 'EXIT' },
    { kind: 'evac_plan', col: 18, row: 7, label: 'Evacuation plan' },
    { kind: 'checkin_flag', col: 15, row: 20, label: 'Assembly' },
  ],
  // Electric sliding doors (interior only). Exit doors (W/E) are deliberately NOT electrical: exit doors must open from
  // the inside without power, keys or special knowledge (29 CFR 1910.36(d)(1)), so they fail safe.
  doors: [
    { id: 'door_a', name: 'door A', label: 'Sliding door A (Red Hat room north)', char: 'A' },
    { id: 'door_b', name: 'door B', label: 'Sliding door B (Red Hat room east)', char: 'B' },
    { id: 'connector', name: 'the lobby connector door', label: 'Lobby connector door', char: 'C' },
    { id: 'south_door', name: 'the south door', label: 'South branch door (to east exit)', zone: 'south_branch', tiles: [{ col: 26, row: 14 }, { col: 27, row: 14 }] },
  ],
  // Manual fire-alarm pull station (one, in the hallway): mounted on a wall tile, operated from the adjacent stand tile.
  // It is the ONLY building-wide alert — spoken notify reaches only people in the same room.
  alarms: [{ id: 'alarm_corridor', name: 'the hallway fire alarm', label: 'Pull station — north corridor', wall: { col: 14, row: 0 }, stand: { col: 14, row: 1 } }],
  spawns: {
    alex: [
      { col: 22, row: 8, dir: 'up', pose: 'sit' },
      { col: 25, row: 11, dir: 'down', pose: 'stand' },
      { col: 20, row: 9, dir: 'right', pose: 'stand' },
    ],
    maya: [
      { col: 13, row: 7, dir: 'up', pose: 'sit' },
      { col: 15, row: 9, dir: 'left', pose: 'stand' },
      { col: 6, row: 16, dir: 'up', pose: 'sit' },
    ],
    daniel: [
      { col: 15, row: 12, dir: 'left', pose: 'sit' },
      { col: 16, row: 10, dir: 'left', pose: 'sit' },
      { col: 12, row: 13, dir: 'up', pose: 'sit' },
    ],
  },
  activity: {
    alex: [
      { col: 22, row: 8 },
      { col: 25, row: 11 },
      { col: 20, row: 9 },
      { col: 28, row: 12 },
    ],
    maya: [
      { col: 13, row: 7 },
      { col: 15, row: 9 },
      { col: 6, row: 16 },
      { col: 7, row: 13 },
    ],
    daniel: [
      { col: 15, row: 12 },
      { col: 16, row: 10 },
      { col: 12, row: 13 },
      { col: 6, row: 7 },
    ],
  },
  zoneStyle: {
    rh_room: [TILE.FLOOR_1, { h: 356, s: 55, b: -38, c: -70 }],
    door_a: [TILE.FLOOR_3, CORRIDOR],
    door_b: [TILE.FLOOR_3, CORRIDOR],
    north_corridor: [TILE.FLOOR_3, CORRIDOR],
    connector: [TILE.FLOOR_3, CORRIDOR],
    lobby: [TILE.FLOOR_7, { h: 95, s: 30, b: -40, c: -80 }],
    south_branch: [TILE.FLOOR_3, CORRIDOR],
    west_exit: [TILE.FLOOR_1, EXIT],
    east_exit: [TILE.FLOOR_1, EXIT],
    west_sidewalk: [TILE.FLOOR_3, PAVING],
    plaza: [TILE.FLOOR_3, PAVING],
    assembly: [TILE.FLOOR_5, { h: 46, s: 75, b: -8, c: -35 }],
  },
  wallColor: { h: 214, s: 30, b: -100, c: -55 },
  checkInPoint: { col: 15, row: 20 },
};

export default spec;
