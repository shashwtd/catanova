export const RULESET = 'base-3-4-v1';
export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
/** Stable storage IDs; these are the names players see throughout Catanova. */
export const RESOURCE_NAMES: Record<Resource, string> = { wood: 'Timber', brick: 'Clay', sheep: 'Sheep', wheat: 'Hay', ore: 'Rock' };
export const SUPPLY = { resourcesPerType: 19, roads: 15, settlements: 5, cities: 4 } as const;
export const DEVELOPMENT_DECK = { knight: 14, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2, victoryPoint: 5 } as const;
export const COSTS = {
  road: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 },
  city: { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 3 },
  developmentCard: { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 },
} as const satisfies Record<string, Record<Resource, number>>;
export const NUMBER_SPIRAL = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11] as const;
