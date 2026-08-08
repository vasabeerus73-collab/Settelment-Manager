import { MAX_CHRONICLE_ENTRIES, MODULE_ID } from "./constants.js";
import { getPacks, getState, setPacks, setState } from "./storage.js";
import { cloneData } from "../utils/data.js";

export const CURRENT_SCHEMA = 2;

/**
 * Migrate legacy 0.x world data in-place.
 * Existing world setting keys remain unchanged, so upgrading does not reset worlds.
 * Вызывать ПОСЛЕ applyCustomPacks(): иначе ресурсы из паков ещё не известны
 * и не попадут в состояние.
 */
export async function runMigrations() {
  if (!game.user?.isGM) return false;

  let changed = false;
  const state = getState();

  state.meta ??= {};
  const oldSchema = Number(state.meta.schemaVersion ?? 0);

  if (oldSchema < 1) {
    state.buildings ??= {};
    state.buildingAccess ??= {};
    state.requests = Array.isArray(state.requests) ? state.requests : [];
    state.projects = Array.isArray(state.projects) ? state.projects : [];
    state.chronicle = Array.isArray(state.chronicle) ? state.chronicle : [];
    state.resources ??= {};
    changed = true;
  }

  if (oldSchema < 2) {
    // Схема 2: найденные чертежи и жёсткий лимит летописи.
    state.blueprints = Array.isArray(state.blueprints) ? [...new Set(state.blueprints.map(String))] : [];
    if (state.chronicle.length > MAX_CHRONICLE_ENTRIES) state.chronicle.length = MAX_CHRONICLE_ENTRIES;
    changed = true;
  }

  if (changed) {
    state.meta.schemaVersion = CURRENT_SCHEMA;
    state.meta.migratedFrom = game.modules.get(MODULE_ID)?.version ?? "legacy";
    state.meta.lastMigrationAt = new Date().toISOString();
  }

  const packs = getPacks();
  const cleanPacks = packs
    .filter((pack) => pack && typeof pack === "object")
    .map((pack) => ({
      id: String(pack.id ?? ""),
      name: String(pack.name ?? pack.id ?? "Пак"),
      description: String(pack.description ?? ""),
      enabled: pack.enabled !== false,
      buildings: Array.isArray(pack.buildings) ? cloneData(pack.buildings) : [],
      resources: Array.isArray(pack.resources) ? cloneData(pack.resources) : [],
      projects: Array.isArray(pack.projects) ? cloneData(pack.projects) : [],
      requests: Array.isArray(pack.requests) ? cloneData(pack.requests) : [],
      blueprints: Array.isArray(pack.blueprints) ? cloneData(pack.blueprints) : []
    }))
    .filter((pack) => pack.id);

  let packsChanged = false;
  if (JSON.stringify(cleanPacks) !== JSON.stringify(packs)) {
    await setPacks(cleanPacks);
    packsChanged = true;
  }

  if (changed) {
    await setState(state);
    console.log(`${MODULE_ID} | World data migrated to schema ${CURRENT_SCHEMA}.`);
  }

  return changed || packsChanged;
}
