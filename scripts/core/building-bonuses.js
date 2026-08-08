import { toCount } from "../utils/data.js";

const BONUS_KEYS = {
  capacity: "capacityBonus",
  defense: "defenseBonus",
  restHealingPercent: "restHealingPercent",
  projectLevel: "projectLevelBonus",
  resourceCapacity: "resourceCapacityBonus"
};

export const BASE_RESOURCE_CAPACITY = 30;

export function calculateBuildingBonuses(state, buildings) {
  const result = {
    capacityBonus: 0,
    defenseBonus: 0,
    restHealingPercent: 0,
    projectLevelBonus: 0,
    resourceCapacityBonus: 0
  };

  for (const definition of Object.values(buildings ?? {})) {
    const currentLevel = toCount(state?.buildings?.[definition.id]?.level);
    if (currentLevel < 1) continue;

    for (const level of definition.levels ?? []) {
      if (toCount(level.level) > currentLevel) continue;
      for (const bonus of level.bonuses ?? []) {
        const key = BONUS_KEYS[String(bonus?.type ?? "")];
        if (key) result[key] += toCount(bonus.value);
      }
    }
  }

  result.restHealingMultiplier = 1 + result.restHealingPercent / 100;
  result.resourceCapacity = BASE_RESOURCE_CAPACITY + result.resourceCapacityBonus;
  return result;
}

export function calculateResourceCapacity(state, buildings) {
  return calculateBuildingBonuses(state, buildings).resourceCapacity;
}
