// office-v2: the ground floor — GPU server room, Red Hat conference room and kitchen along the north side, the main
// hallway, cubicles and the reception lobby to the south, three manual exits, and across the street a bus stop where
// everyone meets.
// Legend: '#' wall · '.' floor (zone from rectangles) · ',' outdoor walkable · '=' road (not walkable)
//         ':' crosswalk · 'X' assembly at the bus stop · 'W'/'E'/'M' west exit / kitchen back exit / main entrance
//         's' 'r' 'p' 'k' 'c' 'd' 'q' electric sliding doors (server, Red Hat room, pantry, kitchen, cubicles,
//         reception, reception side door)
import { TILE, type MapSpec } from './builder.js';

const CORRIDOR = { h: 215, s: 12, b: -8, c: -35 };
const EXIT = { h: 140, s: 60, b: -12, c: -25 };
const PAVING = { h: 36, s: 22, b: -22, c: -55 };
const ASPHALT = { h: 220, s: 6, b: -62, c: -50 };

const spec: MapSpec = {
  id: 'office-v2',
  version: 2,
  ascii: 'office-v2.ascii',
  legend: {
    '#': { terrain: 'wall', zone: null },
    ' ': { terrain: 'void', zone: null },
    '.': { terrain: 'floor', zone: 'rect' },
    ',': { terrain: 'outdoor', zone: 'rect' },
    '=': { terrain: 'outdoor', zone: null, walkable: false, style: [TILE.FLOOR_1, ASPHALT] },
    ':': { terrain: 'outdoor', zone: 'crosswalk' },
    X: { terrain: 'outdoor', zone: 'assembly' },
    W: { terrain: 'floor', zone: 'west_exit' },
    E: { terrain: 'floor', zone: 'back_exit' },
    M: { terrain: 'floor', zone: 'main_entrance' },
    s: { terrain: 'floor', zone: 'server_door' },
    r: { terrain: 'floor', zone: 'rh_door' },
    p: { terrain: 'floor', zone: 'pantry_door' },
    k: { terrain: 'floor', zone: 'kitchen_door' },
    c: { terrain: 'floor', zone: 'cubicles_door' },
    d: { terrain: 'floor', zone: 'reception_door' },
    q: { terrain: 'floor', zone: 'side_door' },
  },
  rects: [
    { zone: 'server_room', cols: [3, 12], rows: [1, 7] },
    { zone: 'rh_room', cols: [14, 27], rows: [1, 7] },
    { zone: 'kitchen', cols: [29, 40], rows: [1, 7] },
    { zone: 'hallway', cols: [3, 40], rows: [9, 11] },
    { zone: 'cubicles', cols: [3, 22], rows: [13, 18] },
    { zone: 'reception', cols: [24, 40], rows: [13, 18] },
    { zone: 'sidewalk', cols: [0, 1], rows: [0, 21] },
    { zone: 'sidewalk', cols: [42, 43], rows: [0, 21] },
    { zone: 'sidewalk', cols: [2, 41], rows: [20, 21] },
    { zone: 'far_sidewalk', cols: [0, 43], rows: [26, 28] },
  ],
  zones: [
    { id: 'server_room', label: 'GPU server room', name: 'the GPU server room', at: 'in the GPU server room', kind: 'room', hazardPlaceable: true, anchor: { col: 6, row: 6 } },
    { id: 'rh_room', label: 'Red Hat conference room', name: 'the Red Hat room', at: 'in the Red Hat room', kind: 'room', hazardPlaceable: true, anchor: { col: 16, row: 6 } },
    { id: 'kitchen', label: 'Kitchen / cafeteria', name: 'the kitchen', at: 'in the kitchen', kind: 'room', hazardPlaceable: true, anchor: { col: 30, row: 6 } },
    { id: 'hallway', label: 'Main hallway', name: 'the main hallway', at: 'in the main hallway', kind: 'corridor', hazardPlaceable: true, anchor: { col: 20, row: 10 } },
    { id: 'cubicles', label: 'Cubicles (workstations)', name: 'the cubicles', at: 'in the cubicles', kind: 'room', hazardPlaceable: true, anchor: { col: 16, row: 16 } },
    { id: 'reception', label: 'Reception lobby', name: 'the reception lobby', at: 'in the reception lobby', kind: 'room', hazardPlaceable: true, anchor: { col: 32, row: 15 } },
    { id: 'server_door', label: 'Server-room door (to the hallway)', name: 'the server-room door', at: 'at the server-room door', kind: 'door', hazardPlaceable: true, anchor: { col: 7, row: 8 } },
    { id: 'rh_door', label: 'Red Hat room door (to the hallway)', name: 'the Red Hat room door', at: 'at the Red Hat room door', kind: 'door', hazardPlaceable: true, anchor: { col: 20, row: 8 } },
    { id: 'pantry_door', label: 'Pantry door (Red Hat room to kitchen)', name: 'the pantry door', at: 'at the pantry door', kind: 'door', hazardPlaceable: true, anchor: { col: 28, row: 3 } },
    { id: 'kitchen_door', label: 'Kitchen door (to the hallway)', name: 'the kitchen door', at: 'at the kitchen door', kind: 'door', hazardPlaceable: true, anchor: { col: 34, row: 8 } },
    { id: 'cubicles_door', label: 'Cubicles door (to the hallway)', name: 'the cubicles door', at: 'at the cubicles door', kind: 'door', hazardPlaceable: true, anchor: { col: 17, row: 12 } },
    { id: 'reception_door', label: 'Reception door (to the hallway)', name: 'the reception door', at: 'at the reception door', kind: 'door', hazardPlaceable: true, anchor: { col: 31, row: 12 } },
    { id: 'side_door', label: 'Side door (cubicles to reception)', name: 'the reception side door', at: 'at the reception side door', kind: 'door', hazardPlaceable: true, anchor: { col: 23, row: 15 } },
    { id: 'west_exit', label: 'West exit (from the hallway)', name: 'the west exit', at: 'at the west exit', kind: 'exit', hazardPlaceable: false, anchor: { col: 2, row: 9 } },
    { id: 'back_exit', label: 'Kitchen back exit (east)', name: 'the kitchen back exit', at: 'at the kitchen back exit', kind: 'exit', hazardPlaceable: false, anchor: { col: 41, row: 3 } },
    { id: 'main_entrance', label: 'Main entrance (from reception, onto the street)', name: 'the main entrance', at: 'at the main entrance', kind: 'exit', hazardPlaceable: false, anchor: { col: 31, row: 19 } },
    { id: 'sidewalk', label: 'Sidewalk (outside the building)', name: 'outside', at: 'outside', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 20, row: 20 } },
    { id: 'crosswalk', label: 'Crosswalk over the street', name: 'the crosswalk', at: 'on the crosswalk', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 31, row: 23 } },
    { id: 'far_sidewalk', label: 'Far sidewalk (across the street)', name: 'across the street', at: 'across the street', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 20, row: 27 } },
    { id: 'assembly', label: 'Assembly point (at the bus stop across the street)', name: 'the assembly point', at: 'at the assembly point', kind: 'assembly', hazardPlaceable: false, anchor: { col: 31, row: 26 } },
  ],
  // Chairs are walkable (people sit on them). Keep the hallway and door approaches clear: wheelchair clearance.
  furniture: [
    // GPU server room — racks along the north wall, an island pair, and Kenji's console
    { type: 'GPU_RACK', col: 3, row: 1 },
    { type: 'GPU_RACK', col: 5, row: 1 },
    { type: 'GPU_RACK', col: 7, row: 1 },
    { type: 'GPU_RACK', col: 9, row: 1 },
    { type: 'GPU_RACK', col: 11, row: 1 },
    { type: 'GPU_RACK', col: 5, row: 4 },
    { type: 'GPU_RACK', col: 7, row: 4 },
    // The 1-wide aisle at column 9 between the island and the console is walkable, NOT wheelchair-accessible.
    { type: 'DESK_FRONT', col: 10, row: 4 },
    { type: 'PC_FRONT_ON_1', col: 11, row: 4 },
    { type: 'WOODEN_CHAIR_BACK', col: 11, row: 5 },
    // Red Hat conference room — a 6×3 table with chairs
    { type: 'TABLE_FRONT', col: 19, row: 2 },
    { type: 'TABLE_FRONT', col: 22, row: 2 },
    { type: 'WOODEN_CHAIR_SIDE', col: 18, row: 2 },
    { type: 'WOODEN_CHAIR_SIDE', col: 18, row: 4 },
    { type: 'WOODEN_CHAIR_SIDE:left', col: 25, row: 2 },
    { type: 'WOODEN_CHAIR_SIDE:left', col: 25, row: 4 },
    { type: 'LARGE_PLANT', col: 14, row: 1 },
    { type: 'PLANT_2', col: 27, row: 6 },
    // Kitchen / cafeteria
    { type: 'KITCHEN_COUNTER', col: 30, row: 1 },
    { type: 'COFFEE_MACHINE', col: 31, row: 1 },
    { type: 'FRIDGE', col: 34, row: 1 },
    { type: 'VENDING_MACHINE', col: 36, row: 1 },
    { type: 'PLANT', col: 40, row: 1 },
    { type: 'SMALL_TABLE_FRONT', col: 32, row: 4 },
    { type: 'SMALL_TABLE_FRONT', col: 37, row: 4 },
    { type: 'CUSHIONED_BENCH', col: 31, row: 5 },
    { type: 'CUSHIONED_BENCH', col: 34, row: 5 },
    { type: 'CUSHIONED_BENCH', col: 36, row: 5 },
    { type: 'CUSHIONED_BENCH', col: 39, row: 5 },
    // Cubicles — four workstations and the warden's pod by the door
    { type: 'CUBICLE', col: 3, row: 13 },
    { type: 'PC_FRONT_ON_1', col: 4, row: 13 },
    { type: 'WOODEN_CHAIR_BACK', col: 4, row: 14 },
    { type: 'CUBICLE', col: 6, row: 13 },
    { type: 'PC_FRONT_ON_2', col: 7, row: 13 },
    { type: 'WOODEN_CHAIR_BACK', col: 7, row: 14 },
    { type: 'CUBICLE', col: 9, row: 13 },
    { type: 'PC_FRONT_ON_3', col: 10, row: 13 },
    { type: 'WOODEN_CHAIR_BACK', col: 10, row: 14 },
    { type: 'CUBICLE', col: 12, row: 13 },
    { type: 'PC_FRONT_ON_1', col: 13, row: 13 },
    { type: 'WOODEN_CHAIR_BACK', col: 13, row: 14 },
    { type: 'CUBICLE', col: 19, row: 13 },
    { type: 'PC_FRONT_ON_2', col: 20, row: 13 },
    { type: 'WOODEN_CHAIR_BACK', col: 20, row: 14 },
    { type: 'PLANT', col: 22, row: 13 },
    { type: 'BIN', col: 3, row: 17 },
    // Reception lobby — front desk, waiting area
    { type: 'RECEPTION_DESK', col: 25, row: 15 },
    { type: 'PC_BACK', col: 25, row: 15 },
    { type: 'SOFA_FRONT', col: 36, row: 14 },
    { type: 'COFFEE_TABLE', col: 36, row: 15 },
    { type: 'LARGE_PLANT', col: 39, row: 13 },
    { type: 'CACTUS', col: 24, row: 13 },
    // Across the street
    { type: 'BUS_SHELTER', col: 37, row: 27 },
  ],
  decor: [
    { kind: 'sign_nvidia_logo', col: 8, row: 0, label: 'NVIDIA' }, // centred on col 8's left edge: the middle of the server room
    { kind: 'sign_redhat', col: 21, row: 0, label: 'RED HAT' }, // centred on col 21's left edge: the middle of the Red Hat room
    { kind: 'sign_welcome', col: 34, row: 12, label: 'WELCOME' },
    { kind: 'evac_plan', col: 14, row: 8, label: 'Evacuation plan' },
    { kind: 'evac_plan', col: 37, row: 12, label: 'Evacuation plan' },
    { kind: 'exit_sign', col: 2, row: 11, label: 'EXIT' },
    { kind: 'exit_sign', col: 41, row: 5, label: 'EXIT' },
    { kind: 'exit_sign', col: 34, row: 19, label: 'EXIT' },
    { kind: 'bus_stop_sign', col: 36, row: 26, label: 'Bus stop' },
    { kind: 'curb', col: 0, row: 22, w: 44, label: 'Kerb (near side)' },
    { kind: 'curb', col: 0, row: 26, w: 44, label: 'Kerb (far side)' },
    { kind: 'lane_line', col: 0, row: 24, w: 30, label: 'Centre line' },
    { kind: 'lane_line', col: 34, row: 24, w: 10, label: 'Centre line' },
    { kind: 'crosswalk', col: 30, row: 22, w: 4, h: 4, label: 'Crosswalk' },
  ],
  // Electric sliding doors (interior only). Exits are deliberately NOT electrical: exit doors must open from the inside
  // without power, keys or special knowledge (29 CFR 1910.36(d)(1)), so they fail safe.
  doors: [
    { id: 'server_door', name: 'the server-room door', label: 'Sliding door — server room', char: 's' },
    { id: 'rh_door', name: 'the Red Hat room door', label: 'Sliding door — Red Hat room', char: 'r' },
    { id: 'pantry_door', name: 'the pantry door', label: 'Sliding door — pantry (Red Hat room to kitchen)', char: 'p' },
    { id: 'kitchen_door', name: 'the kitchen door', label: 'Sliding door — kitchen', char: 'k' },
    { id: 'cubicles_door', name: 'the cubicles door', label: 'Sliding door — cubicles', char: 'c' },
    { id: 'reception_door', name: 'the reception door', label: 'Sliding door — reception', char: 'd' },
    { id: 'side_door', name: 'the reception side door', label: 'Sliding door — cubicles to reception', char: 'q' },
  ],
  // Two manual pull stations: one in the main hallway by the west exit, one in reception by the main entrance.
  // They are the ONLY building-wide alert — spoken notify reaches only people in the same room.
  alarms: [
    { id: 'alarm_hallway', name: 'the hallway fire alarm', label: 'Pull station — main hallway', wall: { col: 4, row: 8 }, stand: { col: 4, row: 9 } },
    { id: 'alarm_reception', name: 'the reception fire alarm', label: 'Pull station — reception (behind the front desk)', wall: { col: 27, row: 12 }, stand: { col: 27, row: 13 } },
  ],
  spawns: {
    alex: [
      { col: 20, row: 15, dir: 'up', pose: 'sit' },
      { col: 17, row: 6, dir: 'up', pose: 'stand' },
      { col: 33, row: 14, dir: 'left', pose: 'stand' },
    ],
    maya: [
      { col: 4, row: 15, dir: 'up', pose: 'sit' },
      { col: 13, row: 15, dir: 'up', pose: 'sit' },
      { col: 35, row: 6, dir: 'up', pose: 'stand' },
    ],
    daniel: [
      { col: 18, row: 5, dir: 'right', pose: 'sit' },
      { col: 22, row: 6, dir: 'up', pose: 'sit' },
      { col: 34, row: 15, dir: 'right', pose: 'sit' },
    ],
    // Behind the front desk (the counter hides her lower half), by the door, in the kitchen.
    rosa: [
      { col: 26, row: 15, dir: 'down', pose: 'sit' },
      { col: 30, row: 14, dir: 'down', pose: 'stand' },
      { col: 31, row: 3, dir: 'up', pose: 'stand' },
    ],
    // At his server-room console, in the rack aisle, in the kitchen.
    kenji: [
      { col: 11, row: 6, dir: 'up', pose: 'sit' },
      { col: 4, row: 3, dir: 'up', pose: 'stand' },
      { col: 32, row: 6, dir: 'up', pose: 'stand' },
    ],
  },
  activity: {
    alex: [
      { col: 20, row: 15 },
      { col: 17, row: 6 },
      { col: 33, row: 14 },
      { col: 20, row: 10 },
    ],
    maya: [
      { col: 4, row: 15 },
      { col: 13, row: 15 },
      { col: 35, row: 6 },
      { col: 8, row: 16 },
    ],
    daniel: [
      { col: 18, row: 5 },
      { col: 22, row: 6 },
      { col: 34, row: 15 },
      { col: 16, row: 3 },
    ],
    rosa: [
      { col: 26, row: 15 },
      { col: 30, row: 14 },
      { col: 31, row: 3 },
      { col: 35, row: 16 },
    ],
    kenji: [
      { col: 11, row: 6 },
      { col: 4, row: 3 },
      { col: 32, row: 6 },
      { col: 3, row: 6 },
    ],
  },
  zoneStyle: {
    server_room: [TILE.FLOOR_3, { h: 100, s: 30, b: -48, c: -60 }],
    rh_room: [TILE.FLOOR_1, { h: 356, s: 55, b: -38, c: -70 }],
    kitchen: [TILE.FLOOR_5, { h: 40, s: 18, b: -6, c: -30 }],
    hallway: [TILE.FLOOR_3, CORRIDOR],
    cubicles: [TILE.FLOOR_1, { h: 222, s: 22, b: -30, c: -60 }],
    reception: [TILE.FLOOR_3, { h: 35, s: 10, b: -4, c: -40 }],
    server_door: [TILE.FLOOR_3, CORRIDOR],
    rh_door: [TILE.FLOOR_3, CORRIDOR],
    pantry_door: [TILE.FLOOR_3, CORRIDOR],
    kitchen_door: [TILE.FLOOR_3, CORRIDOR],
    cubicles_door: [TILE.FLOOR_3, CORRIDOR],
    reception_door: [TILE.FLOOR_3, CORRIDOR],
    side_door: [TILE.FLOOR_3, CORRIDOR],
    west_exit: [TILE.FLOOR_1, EXIT],
    back_exit: [TILE.FLOOR_1, EXIT],
    main_entrance: [TILE.FLOOR_1, EXIT],
    sidewalk: [TILE.FLOOR_3, PAVING],
    crosswalk: [TILE.FLOOR_1, ASPHALT],
    far_sidewalk: [TILE.FLOOR_3, PAVING],
    assembly: [TILE.FLOOR_5, { h: 46, s: 75, b: -8, c: -35 }],
  },
  wallColor: { h: 214, s: 30, b: -100, c: -55 },
  checkInPoint: { col: 31, row: 26 },
};

export default spec;
