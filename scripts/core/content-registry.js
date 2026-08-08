import { cloneData, toCount } from "../utils/data.js";

const BASE_PATH = "modules/settlement-manager/data";

export let BUILDINGS = {};
export let BLUEPRINTS = {};
export let RESOURCE_LABELS = {};
export let RESOURCE_ICONS = {};
export let DEFAULT_STATE = {};
export let CONTENT_MANIFEST = {};

/** Загрузился ли встроенный data-пакет. */
export let CONTENT_READY = false;

let BASE_BUILDINGS = {};
let BASE_RESOURCES = {};

/** Аварийный стейт: модуль остаётся управляемым, даже если data-пакет не читается. */
const FALLBACK_STATE = {
  name: "Безымянное поселение",
  description: "",
  level: 1,
  population: 0,
  capacity: 1,
  morale: 50,
  defense: 0,
  resources: {},
  buildings: {},
  buildingAccess: {},
  blueprints: [],
  requests: [],
  projects: [],
  chronicle: []
};

async function fetchJson(path) {
  const response = await fetch(`${BASE_PATH}/${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}

function validateResourceMap(resources) {
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) throw new Error("resources.json должен содержать объект ресурсов.");
  for (const [id, entry] of Object.entries(resources)) {
    if (!entry || typeof entry !== "object") throw new Error(`Ресурс ${id}: неверная запись.`);
    if (!entry.label) throw new Error(`Ресурс ${id}: отсутствует label.`);
    entry.id ??= id;
    entry.icon ??= "fa-solid fa-box";
  }
  return resources;
}

export function validateBuilding(building, source = "custom") {
  if (!building || typeof building !== "object") throw new Error(`${source}: здание должно быть объектом.`);
  const result = cloneData(building);
  if (!result.id) throw new Error(`${source}: отсутствует id.`);
  if (!result.name) throw new Error(`${source}: отсутствует name.`);
  if (!Array.isArray(result.levels) || result.levels.length === 0) throw new Error(`${source}: отсутствуют levels.`);

  const seen = new Set();
  for (const level of result.levels) {
    const n = Number(level.level);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${source}: неверный level.`);
    if (seen.has(n)) throw new Error(`${source}: повтор уровня ${n}.`);
    seen.add(n);
    level.level = n;
    level.durationDays = Math.max(1, toCount(level.durationDays, 1) || 1);
    // Нормализуем стоимость: только положительные целые.
    const cost = {};
    for (const [resourceId, amount] of Object.entries(level.cost ?? {})) {
      const value = toCount(amount);
      if (value > 0) cost[resourceId] = value;
    }
    level.cost = cost;
    level.effects = Array.isArray(level.effects) ? level.effects.map((entry) => String(entry)) : [];
  }

  result.levels.sort((left, right) => Number(left.level) - Number(right.level));
  result.icon ??= "fa-solid fa-building";
  result.category ??= "Прочее";
  result.description ??= "";
  result.maxLevel = result.levels.length;
  return result;
}

export function validateBlueprint(blueprint, source = "custom") {
  if (!blueprint || typeof blueprint !== "object") throw new Error(`${source}: чертёж должен быть объектом.`);
  const result = cloneData(blueprint);
  if (!result.id) throw new Error(`${source}: у чертежа отсутствует id.`);
  if (!result.name) throw new Error(`${source}: у чертежа отсутствует name.`);
  result.description ??= "";
  result.unlocks = Array.isArray(result.unlocks) ? [...new Set(result.unlocks.map((entry) => String(entry)))] : [];
  return result;
}

function validateDefaultState(state, resources) {
  if (!state || typeof state !== "object") throw new Error("default-state.json должен содержать объект.");
  state.resources ??= {};
  for (const id of Object.keys(resources)) if (state.resources[id] === undefined) state.resources[id] = 0;
  state.buildings ??= {};
  state.buildingAccess ??= {};
  state.blueprints = Array.isArray(state.blueprints) ? state.blueprints : [];
  state.requests = Array.isArray(state.requests) ? state.requests : [];
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.chronicle = Array.isArray(state.chronicle) ? state.chronicle : [];
  return state;
}

function publish(buildings, resources, blueprints) {
  BUILDINGS = buildings;
  BLUEPRINTS = blueprints;
  RESOURCE_LABELS = Object.fromEntries(Object.entries(resources).map(([id, entry]) => [id, entry.label]));
  RESOURCE_ICONS = Object.fromEntries(Object.entries(resources).map(([id, entry]) => [id, entry.icon]));
}

export async function loadContent() {
  const manifest = await fetchJson("manifest.json");
  const resources = validateResourceMap(await fetchJson(manifest.resources));
  const defaultState = validateDefaultState(await fetchJson(manifest.defaultState), resources);
  const buildingFiles = await fetchJson(manifest.buildingsIndex);
  if (!Array.isArray(buildingFiles)) throw new Error("buildings/index.json должен содержать массив имён файлов.");

  const buildings = {};
  for (const file of buildingFiles) {
    const building = validateBuilding(await fetchJson(`buildings/${file}`), file);
    if (buildings[building.id]) throw new Error(`Повторяющийся id здания: ${building.id}`);
    for (const level of building.levels) {
      for (const resourceId of Object.keys(level.cost)) {
        if (!resources[resourceId]) throw new Error(`${file}: неизвестный ресурс в стоимости: ${resourceId}`);
      }
    }
    buildings[building.id] = building;
  }

  CONTENT_MANIFEST = manifest;
  DEFAULT_STATE = defaultState;
  BASE_BUILDINGS = cloneData(buildings);
  BASE_RESOURCES = cloneData(resources);
  publish(cloneData(BASE_BUILDINGS), cloneData(BASE_RESOURCES), {});
  CONTENT_READY = true;

  console.log(`settlement-manager | Content loaded: ${Object.keys(BUILDINGS).length} зданий, ${Object.keys(RESOURCE_LABELS).length} ресурсов.`);
  return { manifest: CONTENT_MANIFEST, buildings: BUILDINGS, resources, defaultState: DEFAULT_STATE };
}

/** Аварийный режим — вызывается, если loadContent() упал. */
export function useFallbackContent() {
  CONTENT_MANIFEST = {};
  DEFAULT_STATE = cloneData(FALLBACK_STATE);
  BASE_BUILDINGS = {};
  BASE_RESOURCES = {};
  publish({}, {}, {});
  CONTENT_READY = false;
}

/**
 * Пересобирает активный контент из встроенного набора и включённых паков.
 * @param {Array<object>} packs
 * @returns {{errors: string[]}} проблемы, которые стоит показать ГМу
 */
export function applyCustomPacks(packs = []) {
  const resources = cloneData(BASE_RESOURCES);
  const buildings = cloneData(BASE_BUILDINGS);
  const blueprints = {};
  const errors = [];

  for (const pack of (Array.isArray(packs) ? packs : [])) {
    if (!pack?.enabled) continue;
    const label = pack.name ?? pack.id ?? "пак";

    for (const resource of (pack.resources ?? [])) {
      if (!resource?.id || !resource?.label) {
        errors.push(`Пак «${label}»: ресурс без id или названия пропущен.`);
        continue;
      }
      resources[resource.id] = { id: resource.id, label: resource.label, icon: resource.icon || "fa-solid fa-box" };
    }

    for (const raw of (pack.buildings ?? [])) {
      try {
        const building = validateBuilding(raw, `Пак «${label}»`);
        for (const level of building.levels) {
          for (const resourceId of Object.keys(level.cost)) {
            if (!resources[resourceId]) throw new Error(`неизвестный ресурс «${resourceId}» в стоимости уровня ${level.level}`);
          }
        }
        buildings[building.id] = building;
      } catch (error) {
        const message = `Пак «${label}», постройка «${raw?.name ?? raw?.id ?? "без имени"}»: ${error.message}`;
        errors.push(message);
        console.error(`settlement-manager | ${message}`, raw, error);
      }
    }

    for (const raw of (pack.blueprints ?? [])) {
      try {
        const blueprint = validateBlueprint(raw, `Пак «${label}»`);
        blueprints[blueprint.id] = blueprint;
      } catch (error) {
        const message = `Пак «${label}», чертёж «${raw?.name ?? raw?.id ?? "без имени"}»: ${error.message}`;
        errors.push(message);
        console.error(`settlement-manager | ${message}`, raw, error);
      }
    }
  }

  publish(buildings, resources, blueprints);
  return { errors };
}

export function getContentSnapshot() {
  return {
    manifest: cloneData(CONTENT_MANIFEST),
    buildings: cloneData(BUILDINGS),
    blueprints: cloneData(BLUEPRINTS),
    resources: Object.fromEntries(Object.keys(RESOURCE_LABELS).map((id) => [id, { id, label: RESOURCE_LABELS[id], icon: RESOURCE_ICONS[id] }])),
    defaultState: cloneData(DEFAULT_STATE)
  };
}
