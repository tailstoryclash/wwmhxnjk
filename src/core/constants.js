export const CELL = 4; // metres per grid cell
export const WALL_H = 5; // ceiling height of enclosed cells
export const OPEN_H = 11; // glass-roof height of open ("atrium") cells
export const DOOR_H = 3.1;
export const DOOR_W = 2.6;
export const NAV_RES = 4; // nav cells per grid cell (1 m)
export const LM_RES = 3; // lightmap texels per metre

export const PLAYER = { radius: 0.42, height: 1.8, eye: 1.62, step: 0.4 };
export const GRAVITY = 22;

export const DIFFICULTY = {
  story: { label: 'Story', enemyDamage: 0.5, enemyHealth: 0.8, lead: 0.2 },
  normal: { label: 'Marshal', enemyDamage: 1, enemyHealth: 1, lead: 0.5 },
  hard: { label: 'Hollow', enemyDamage: 1.5, enemyHealth: 1.3, lead: 0.85 },
};
