import { BUILDINGS, DEFAULT_STATE, MAX_CHRONICLE_ENTRIES, MODULE_ID, RESOURCE_LABELS, STATE_KEY } from "./constants.js";
import { cloneData, deepMerge, toCount } from "../utils/data.js";
import { calculateResourceCapacity } from "./building-bonuses.js";

export const PACKS_KEY = "contentPacks";

function clone(value) { return cloneData(value); }

/**
 * Приводит сохранённое состояние к текущей схеме.
 * Ключевая гарантия: стейт содержит ключи ВСЕХ активных ресурсов, иначе
 * арифметика стоимости даёт NaN и сохраняется в мир как null.
 */
function mergeState(saved = {}) {
  const merged = deepMerge(clone(DEFAULT_STATE ?? {}), saved ?? {});

  merged.resources ??= {};
  for (const [key, value] of Object.entries(DEFAULT_STATE?.resources ?? {})) {
    if (merged.resources[key] === undefined) merged.resources[key] = value;
  }
  // Ресурсы, пришедшие из контент-паков, тоже должны существовать в стейте.
  for (const key of Object.keys(RESOURCE_LABELS ?? {})) {
    if (merged.resources[key] === undefined) merged.resources[key] = 0;
  }
  for (const [key, value] of Object.entries(merged.resources)) {
    merged.resources[key] = toCount(value);
  }

  merged.buildings ??= {};
  const resourceCapacity = calculateResourceCapacity(merged, BUILDINGS);
  for (const key of Object.keys(merged.resources)) {
    merged.resources[key] = Math.min(merged.resources[key], resourceCapacity);
  }
  merged.buildingAccess ??= {};
  merged.blueprints = Array.isArray(merged.blueprints) ? [...new Set(merged.blueprints.map(String))] : [];
  merged.requests = Array.isArray(merged.requests) ? merged.requests : clone(DEFAULT_STATE?.requests ?? []);
  merged.projects = Array.isArray(merged.projects) ? merged.projects : clone(DEFAULT_STATE?.projects ?? []);
  for (const request of merged.requests) {
    if (request.moraleReward === undefined) {
      const legacyReward = String(request.reward ?? "").match(/\+?(\d+)\s*морал/iu);
      request.moraleReward = legacyReward ? toCount(legacyReward[1]) : 0;
    } else {
      request.moraleReward = toCount(request.moraleReward);
    }
    request.moralePenalty = toCount(request.moralePenalty);
  }
  for (const project of merged.projects) {
    project.levelReward = project.levelReward === undefined ? 1 : toCount(project.levelReward);
  }
  merged.chronicle = Array.isArray(merged.chronicle) ? merged.chronicle : [];
  if (merged.chronicle.length > MAX_CHRONICLE_ENTRIES) merged.chronicle.length = MAX_CHRONICLE_ENTRIES;
  if (merged.description === undefined) merged.description = DEFAULT_STATE?.description ?? "";
  if (merged.defense === undefined) merged.defense = DEFAULT_STATE?.defense ?? 0;

  return merged;
}

export function registerSettings(onChange, onPacksChange) {
  game.settings.register(MODULE_ID, PACKS_KEY, {
    name: "Settlement Manager: content packs",
    hint: "Пользовательские контент-паки Settlement Manager.",
    scope: "world",
    config: false,
    type: String,
    default: "[]",
    onChange: onPacksChange
  });
  game.settings.register(MODULE_ID, STATE_KEY, {
    name: "Settlement Manager: state",
    hint: "Внутреннее состояние поселения. Изменяйте его через интерфейс Settlement Manager.",
    scope: "world",
    config: false,
    type: String,
    default: JSON.stringify(DEFAULT_STATE ?? {}),
    onChange
  });
}

export function getState() {
  let raw;
  try {
    raw = game.settings.get(MODULE_ID, STATE_KEY);
  } catch (error) {
    console.error(`${MODULE_ID} | Настройка состояния ещё не зарегистрирована.`, error);
    return mergeState({});
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return mergeState(parsed ?? {});
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось прочитать состояние`, error);
    return mergeState({});
  }
}

export async function setState(state) {
  return game.settings.set(MODULE_ID, STATE_KEY, JSON.stringify(mergeState(state)));
}

export function getPacks() {
  let raw;
  try {
    raw = game.settings.get(MODULE_ID, PACKS_KEY);
  } catch (error) {
    console.error(`${MODULE_ID} | Настройка паков ещё не зарегистрирована.`, error);
    return [];
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? cloneData(parsed) : [];
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось прочитать контент-паки`, error);
    return [];
  }
}

export async function setPacks(packs) {
  return game.settings.set(MODULE_ID, PACKS_KEY, JSON.stringify(Array.isArray(packs) ? packs : []));
}

/**
 * Сбрасывает только игровое состояние поселения.
 * Контент-паки лежат под PACKS_KEY и намеренно не трогаются.
 * @returns {Promise<object>} свежее состояние
 */
export async function resetSettlementState() {
  const fresh = clone(DEFAULT_STATE);

  fresh.meta ??= {};
  fresh.meta.schemaVersion = 2;
  fresh.meta.lastFactoryResetAt = new Date().toISOString();

  await setState(fresh);
  return getState();
}
