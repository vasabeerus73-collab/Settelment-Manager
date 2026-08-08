import {
  ACCESS_VALUES,
  BLUEPRINTS,
  BUILDINGS,
  DEFAULT_STATE,
  MAX_CHRONICLE_ENTRIES,
  REQUEST_STATUS,
  RESOURCE_LABELS,
  SECONDS_PER_DAY
} from "../core/constants.js";
import { getState, setState } from "../core/storage.js";
import { cloneData, toCount } from "../utils/data.js";
import { entryId } from "../utils/ids.js";
import { calculateBuildingBonuses } from "../core/building-bonuses.js";

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("Settlement Manager: изменять поселение может только ГМ.");
  return false;
}

function getLevelDefinition(definition, level) {
  return definition?.levels?.find((entry) => Number(entry.level) === Number(level)) ?? null;
}

/** Приводит запись здания к актуальной форме, не мутируя исходник. */
export function normalizeBuildingState(buildingId, current) {
  if (!current || typeof current !== "object") return { id: buildingId, level: 0, status: "available" };
  const next = { ...current, id: buildingId };
  next.level = toCount(next.level);
  if (next.status === "complete" && next.level < 1) next.level = 1;
  next.status = next.status ?? (next.level > 0 ? "complete" : "available");
  return next;
}

function worldDayLabel() {
  const day = Math.floor(Number(game.time?.worldTime ?? 0) / SECONDS_PER_DAY) + 1;
  return `День ${day}`;
}

/** Единственная точка записи в летопись: гарантирует поля и лимит длины. */
function pushChronicle(state, entry) {
  const record = { id: entryId("chronicle"), date: worldDayLabel(), title: "", text: "", type: "manual" };
  // Явное присваивание вместо spread: `{date: undefined}` не должен затирать дефолт.
  for (const [key, value] of Object.entries(entry ?? {})) {
    if (value !== undefined) record[key] = value;
  }
  state.chronicle ??= [];
  state.chronicle.unshift(record);
  if (state.chronicle.length > MAX_CHRONICLE_ENTRIES) state.chronicle.length = MAX_CHRONICLE_ENTRIES;
  return state;
}

export class SettlementService {
  /** Защита от параллельных read-modify-write при проверке стройки. */
  #checkingConstruction = false;

  getData() {
    return getState();
  }

  getBuildingBonuses(state = getState()) {
    return calculateBuildingBonuses(state, BUILDINGS);
  }

  getFeatureAccess(state = getState()) {
    const townHallLevel = toCount(state.buildings?.townhall?.level);
    return {
      board: townHallLevel >= 1,
      chronicle: townHallLevel >= 1,
      townHallLevel
    };
  }

  getResourceCapacity(state = getState()) {
    return this.getBuildingBonuses(state).resourceCapacity;
  }

  getEffectiveData(state = getState()) {
    const buildingBonuses = this.getBuildingBonuses(state);
    return {
      ...cloneData(state),
      capacity: Math.max(1, toCount(state.capacity, 1) + buildingBonuses.capacityBonus),
      defense: toCount(state.defense) + buildingBonuses.defenseBonus,
      buildingBonuses
    };
  }

  getRestHealingBonus(state = getState()) {
    const bonuses = this.getBuildingBonuses(state);
    return {
      percent: bonuses.restHealingPercent,
      multiplier: bonuses.restHealingMultiplier,
      infirmaryLevel: toCount(state.buildings?.infirmary?.level)
    };
  }

  calculateRestHealing(baseAmount, state = getState()) {
    const amount = Math.max(0, Number(baseAmount) || 0);
    return Math.floor(amount * this.getRestHealingBonus(state).multiplier);
  }

  getBuildings() {
    return BUILDINGS;
  }

  getBlueprints() {
    return BLUEPRINTS;
  }

  getBuilding(buildingId) {
    const definition = BUILDINGS[buildingId];
    if (!definition) return null;
    const state = getState();
    return {
      definition,
      state: normalizeBuildingState(buildingId, state.buildings?.[buildingId]),
      nextLevel: this.getNextLevel(buildingId, state)
    };
  }

  getNextLevel(buildingId, state = getState()) {
    const definition = BUILDINGS[buildingId];
    if (!definition) return null;
    const current = normalizeBuildingState(buildingId, state.buildings?.[buildingId]);
    return getLevelDefinition(definition, current.level + 1);
  }

  getActiveConstruction(state = getState()) {
    for (const [buildingId, value] of Object.entries(state.buildings ?? {})) {
      if (value?.status === "building" && BUILDINGS[buildingId]) {
        return { buildingId, ...cloneData(value) };
      }
    }
    return null;
  }

  async updateCore(values = {}) {
    if (!requireGM()) return false;
    const state = getState();

    if (values.name !== undefined) state.name = String(values.name).trim() || "Безымянное поселение";
    if (values.description !== undefined) state.description = String(values.description).trim();
    if (values.level !== undefined) state.level = Math.max(1, toCount(values.level, 1));
    if (values.population !== undefined) state.population = toCount(values.population);
    if (values.capacity !== undefined) state.capacity = Math.max(1, toCount(values.capacity, 1));
    if (values.morale !== undefined) state.morale = Math.min(100, Math.max(0, toCount(values.morale)));
    if (values.defense !== undefined) state.defense = toCount(values.defense);

    if (values.resources) {
      for (const key of Object.keys(RESOURCE_LABELS)) {
        if (values.resources[key] !== undefined) state.resources[key] = toCount(values.resources[key]);
      }
    }

    await setState(state);
    return true;
  }

  /* --------------------------------- Ресурсы -------------------------------- */

  getResource(resource) {
    return toCount(getState().resources?.[resource]);
  }

  hasResources(cost = {}, state = getState()) {
    return Object.entries(cost).every(([resource, amount]) => toCount(state.resources?.[resource]) >= toCount(amount));
  }

  async addResource(resource, amount) {
    if (!requireGM()) return false;
    // Проверяем по активному контенту, а не по стейту: ресурс из пака
    // может ещё не иметь записи в мире.
    if (!(resource in RESOURCE_LABELS)) {
      ui.notifications.error(`Settlement Manager: неизвестный ресурс «${resource}».`);
      return false;
    }
    const state = getState();
    const delta = toCount(amount);
    const current = toCount(state.resources[resource]);
    const added = Math.min(delta, Math.max(0, this.getResourceCapacity(state) - current));
    if (added <= 0) {
      ui.notifications.warn(`${RESOURCE_LABELS[resource] ?? resource}: склад заполнен.`);
      return false;
    }
    state.resources[resource] = current + added;
    await setState(state);
    ui.notifications.info(`${RESOURCE_LABELS[resource] ?? resource}: +${added}`);
    return true;
  }

  async addResources(resources = {}) {
    if (!requireGM()) return false;

    const state = getState();
    const added = [];
    const resourceCapacity = this.getResourceCapacity(state);

    for (const [resource, rawAmount] of Object.entries(resources ?? {})) {
      if (!(resource in RESOURCE_LABELS)) continue;
      const delta = toCount(rawAmount);
      if (delta <= 0) continue;

      state.resources ??= {};
      const current = toCount(state.resources[resource]);
      const actualDelta = Math.min(delta, Math.max(0, resourceCapacity - current));
      if (actualDelta <= 0) continue;
      state.resources[resource] = current + actualDelta;
      added.push({ resource, delta: actualDelta, label: RESOURCE_LABELS[resource] ?? resource });
    }

    if (!added.length) {
      ui.notifications.warn("Введите количество хотя бы одного ресурса для добавления.");
      return false;
    }

    await setState(state);
    ui.notifications.info(`Добавлено: ${added.map((entry) => `${entry.label} +${entry.delta}`).join(", ")}`);
    return added;
  }

  async removeResource(resource, amount) {
    if (!requireGM()) return false;
    if (!(resource in RESOURCE_LABELS)) {
      ui.notifications.error(`Settlement Manager: неизвестный ресурс «${resource}».`);
      return false;
    }
    const state = getState();
    const delta = toCount(amount);
    const have = toCount(state.resources[resource]);
    if (have < delta) {
      ui.notifications.warn(`Недостаточно ресурса «${RESOURCE_LABELS[resource] ?? resource}».`);
      return false;
    }
    state.resources[resource] = have - delta;
    await setState(state);
    ui.notifications.info(`${RESOURCE_LABELS[resource] ?? resource}: -${delta}`);
    return true;
  }

  /* --------------------------------- Чертежи -------------------------------- */

  /** Постройки, открытые найденными чертежами. */
  getBlueprintUnlocks(state = getState()) {
    const known = new Set(state.blueprints ?? []);
    const unlocked = new Set();
    for (const [id, blueprint] of Object.entries(BLUEPRINTS)) {
      if (!known.has(id)) continue;
      for (const buildingId of blueprint.unlocks ?? []) unlocked.add(buildingId);
    }
    return unlocked;
  }

  isBlueprintKnown(blueprintId, state = getState()) {
    return (state.blueprints ?? []).includes(blueprintId);
  }

  async setBlueprintKnown(blueprintId, known = true) {
    if (!requireGM()) return false;
    const blueprint = BLUEPRINTS[blueprintId];
    if (!blueprint) {
      ui.notifications.warn("Settlement Manager: такой чертёж не найден среди включённых паков.");
      return false;
    }
    const state = getState();
    const set = new Set(state.blueprints ?? []);
    if (known === set.has(blueprintId)) return true;
    if (known) set.add(blueprintId);
    else set.delete(blueprintId);
    state.blueprints = [...set];

    if (known) {
      pushChronicle(state, {
        title: `Найден чертёж: ${blueprint.name}`,
        text: blueprint.unlocks?.length
          ? `Открывает: ${blueprint.unlocks.map((id) => BUILDINGS[id]?.name ?? id).join(", ")}.`
          : "",
        type: "blueprint"
      });
    }

    await setState(state);
    ui.notifications.info(known ? `Чертёж «${blueprint.name}» выдан поселению.` : `Чертёж «${blueprint.name}» отозван.`);
    return true;
  }

  /* --------------------------------- Доступ --------------------------------- */

  /** «Сырой» режим доступа, выставленный ГМом вручную. */
  getBuildingAccess(buildingId, state = getState()) {
    const value = state.buildingAccess?.[buildingId];
    return ACCESS_VALUES.includes(value) ? value : "unlocked";
  }

  /** Доступ с учётом чертежей: найденный чертёж открывает постройку. */
  getEffectiveAccess(buildingId, state = getState(), unlocks = this.getBlueprintUnlocks(state)) {
    const access = this.getBuildingAccess(buildingId, state);
    if (access === "unlocked") return "unlocked";
    return unlocks.has(buildingId) ? "unlocked" : access;
  }

  async setBuildingAccess(buildingId, access) {
    if (!requireGM()) return false;
    if (!BUILDINGS[buildingId]) return false;
    if (!ACCESS_VALUES.includes(access)) return false;
    const state = getState();
    state.buildingAccess ??= {};
    state.buildingAccess[buildingId] = access;
    await setState(state);
    const labels = { unlocked: "открыта для строительства", locked: "видна игрокам, но требует чертёж", hidden: "скрыта от игроков" };
    ui.notifications.info(`${BUILDINGS[buildingId].name}: ${labels[access]}.`);
    return true;
  }

  /* ------------------------------ Строительство ----------------------------- */

  canBuild(buildingId, state = getState()) {
    const definition = BUILDINGS[buildingId];
    if (!definition) return { ok: false, reason: "Неизвестное здание.", missing: {}, targetLevel: null };

    const access = this.getEffectiveAccess(buildingId, state);
    if (access !== "unlocked") {
      return {
        ok: false,
        reason: access === "hidden" ? "Постройка ещё не открыта." : "Для строительства нужен найденный чертёж.",
        missing: {},
        targetLevel: null
      };
    }

    const active = this.getActiveConstruction(state);
    if (active && active.buildingId !== buildingId) {
      return { ok: false, reason: "Строительная бригада уже занята.", missing: {}, targetLevel: null };
    }

    const current = normalizeBuildingState(buildingId, state.buildings?.[buildingId]);
    if (current.status === "building") return { ok: false, reason: "Это здание уже строится или улучшается.", missing: {}, targetLevel: null };

    const targetLevel = current.level + 1;
    const levelDefinition = getLevelDefinition(definition, targetLevel);
    if (!levelDefinition) return { ok: false, reason: "Достигнут максимальный уровень.", missing: {}, targetLevel: null };

    const missing = {};
    for (const [resource, amount] of Object.entries(levelDefinition.cost ?? {})) {
      const have = toCount(state.resources?.[resource]);
      if (have < toCount(amount)) missing[resource] = toCount(amount) - have;
    }

    if (Object.keys(missing).length) return { ok: false, reason: "Недостаточно ресурсов.", missing, targetLevel };
    return { ok: true, reason: null, missing: {}, targetLevel };
  }

  async startConstruction(buildingId, { requestedBy = null, quiet = false } = {}) {
    if (!requireGM()) return false;
    const definition = BUILDINGS[buildingId];
    if (!definition) return false;

    // Читаем состояние один раз и на нём же проверяем: иначе между canBuild()
    // и записью может вклиниться другой клиент.
    const state = getState();
    const check = this.canBuild(buildingId, state);
    if (!check.ok) {
      ui.notifications.warn(check.reason);
      return false;
    }

    const current = normalizeBuildingState(buildingId, state.buildings?.[buildingId]);
    const targetLevel = Number(check.targetLevel);
    const levelDefinition = getLevelDefinition(definition, targetLevel);

    for (const [resource, amount] of Object.entries(levelDefinition.cost ?? {})) {
      state.resources[resource] = Math.max(0, toCount(state.resources[resource]) - toCount(amount));
    }

    const startedAt = Number(game.time?.worldTime ?? 0);
    state.buildings[buildingId] = {
      id: buildingId,
      level: current.level,
      status: "building",
      targetLevel,
      startedAt,
      completesAt: startedAt + Math.max(1, Number(levelDefinition.durationDays) || 1) * SECONDS_PER_DAY
    };

    pushChronicle(state, {
      title: targetLevel === 1 ? `Начато строительство: ${definition.name}` : `Начато улучшение: ${definition.name}`,
      text: requestedBy ? `Целевой уровень: ${targetLevel}. Инициатор: ${requestedBy}.` : `Целевой уровень: ${targetLevel}.`,
      type: "construction"
    });

    await setState(state);
    if (!quiet) ui.notifications.info(`${targetLevel === 1 ? "Строительство" : "Улучшение"} «${definition.name}» до уровня ${targetLevel} начато.`);
    return true;
  }

  async checkConstruction({ announce = true } = {}) {
    if (!game.user?.isGM) return [];
    // updateWorldTime может выстрелить несколько раз подряд; параллельные
    // read-modify-write перетирали бы друг друга и дублировали уведомления.
    if (this.#checkingConstruction) return [];
    this.#checkingConstruction = true;
    try {
      const state = getState();
      const now = Number(game.time?.worldTime ?? 0);
      const completed = [];

      for (const [buildingId, buildingState] of Object.entries(state.buildings ?? {})) {
        if (!BUILDINGS[buildingId]) continue;
        if (buildingState?.status !== "building") continue;
        if (Number(buildingState.completesAt ?? Infinity) > now) continue;

        const definition = BUILDINGS[buildingId];
        const completedLevel = Math.max(1, toCount(buildingState.targetLevel ?? buildingState.level));
        buildingState.status = "complete";
        buildingState.level = completedLevel;
        buildingState.completedAt = now;
        delete buildingState.targetLevel;
        delete buildingState.startedAt;
        delete buildingState.completesAt;
        completed.push({ id: buildingId, name: definition.name, level: completedLevel });

        pushChronicle(state, {
          title: `Завершено: ${definition.name}`,
          text: `Здание достигло уровня ${completedLevel}.`,
          type: "construction"
        });
      }

      if (!completed.length) return [];
      await setState(state);
      if (announce) for (const entry of completed) ui.notifications.info(`Завершено: ${entry.name}, уровень ${entry.level}.`);
      return completed;
    } finally {
      this.#checkingConstruction = false;
    }
  }

  /* --------------------------------- Просьбы -------------------------------- */

  async addRequest(data = {}) {
    if (!requireGM()) return false;
    const title = String(data.title ?? "").trim();
    if (!title) {
      ui.notifications.warn("Укажите название просьбы.");
      return false;
    }
    const state = getState();
    state.requests.unshift({
      id: entryId("request"),
      title,
      requester: String(data.requester ?? "Жители").trim() || "Жители",
      description: String(data.description ?? "").trim(),
      reward: String(data.reward ?? "").trim(),
      moraleReward: toCount(data.moraleReward),
      moralePenalty: toCount(data.moralePenalty),
      status: "available"
    });
    await setState(state);
    return true;
  }

  async setRequestStatus(id, status) {
    if (!requireGM()) return false;
    if (!(status in REQUEST_STATUS)) return false;
    const state = getState();
    const request = state.requests.find((entry) => entry.id === id);
    if (!request) return false;
    if ((status === "complete" || status === "failed") && request.status !== "accepted") {
      ui.notifications.warn("Сначала просьба должна быть принята.");
      return false;
    }
    request.status = status;
    if (status === "complete") {
      const moraleReward = toCount(request.moraleReward);
      state.morale = Math.min(100, toCount(state.morale) + moraleReward);
      pushChronicle(state, {
        title: `Выполнена просьба: ${request.title}`,
        text: `${request.requester ? `Проситель: ${request.requester}. ` : ""}Мораль: +${moraleReward}.`.trim(),
        type: "request"
      });
    } else if (status === "failed") {
      const moralePenalty = toCount(request.moralePenalty);
      state.morale = Math.max(0, toCount(state.morale) - moralePenalty);
      pushChronicle(state, {
        title: `Провалена просьба: ${request.title}`,
        text: `${request.requester ? `Проситель: ${request.requester}. ` : ""}Мораль: -${moralePenalty}.`.trim(),
        type: "request"
      });
    }
    await setState(state);
    return true;
  }

  async acceptRequest(id, { acceptedBy = null } = {}) {
    if (!requireGM()) return false;
    const state = getState();
    const request = state.requests.find((entry) => entry.id === id);
    if (!request) return false;
    if (request.status !== "available") {
      ui.notifications.warn("Эта просьба уже принята или завершена.");
      return false;
    }
    request.status = "accepted";
    request.acceptedBy = String(acceptedBy ?? "").trim();
    await setState(state);
    return true;
  }

  async deleteRequest(id) {
    if (!requireGM()) return false;
    const state = getState();
    state.requests = state.requests.filter((entry) => entry.id !== id);
    await setState(state);
    return true;
  }

  /* --------------------------------- Проекты -------------------------------- */

  async addProject(data = {}) {
    if (!requireGM()) return false;
    const title = String(data.title ?? "").trim();
    if (!title) {
      ui.notifications.warn("Укажите название проекта.");
      return false;
    }
    const state = getState();
    const requirements = {};
    for (const key of Object.keys(RESOURCE_LABELS)) {
      const amount = toCount(data.requirements?.[key]);
      if (amount > 0) requirements[key] = amount;
    }
    state.projects.unshift({
      id: entryId("project"),
      title,
      description: String(data.description ?? "").trim(),
      reward: String(data.reward ?? "").trim(),
      levelReward: toCount(data.levelReward),
      status: "available",
      requirements
    });
    await setState(state);
    return true;
  }

  canStartProject(id, state = getState()) {
    const project = state.projects?.find((entry) => entry.id === id);
    if (!project) return { ok: false, reason: "Проект не найден." };
    if (project.status !== "available") return { ok: false, reason: "Проект уже начат или завершён." };
    if (!this.hasResources(project.requirements ?? {}, state)) return { ok: false, reason: "Недостаточно ресурсов." };
    return { ok: true, reason: null };
  }

  async startProject(id, { requestedBy = null } = {}) {
    if (!requireGM()) return false;
    const state = getState();
    const check = this.canStartProject(id, state);
    if (!check.ok) {
      ui.notifications.warn(check.reason);
      return false;
    }
    const project = state.projects.find((entry) => entry.id === id);
    for (const [resource, amount] of Object.entries(project.requirements ?? {})) {
      state.resources[resource] = Math.max(0, toCount(state.resources[resource]) - toCount(amount));
    }
    project.status = "active";
    project.startedBy = String(requestedBy ?? "").trim();
    const initiator = project.startedBy ? ` Взял: ${project.startedBy}.` : "";
    pushChronicle(state, { title: `Начат проект: ${project.title}`, text: `${project.description ?? ""}${initiator}`.trim(), type: "project" });
    await setState(state);
    return true;
  }

  async completeProject(id) {
    if (!requireGM()) return false;
    const state = getState();
    const project = state.projects.find((entry) => entry.id === id);
    if (!project) return false;
    if (project.status === "complete") return true;
    if (project.status !== "active") {
      ui.notifications.warn("Сначала проект должен быть взят в работу.");
      return false;
    }
    project.status = "complete";
    const baseLevelReward = toCount(project.levelReward);
    const projectLevelBonus = this.getBuildingBonuses(state).projectLevelBonus;
    const levelReward = baseLevelReward + projectLevelBonus;
    state.level = Math.max(1, toCount(state.level, 1) + levelReward);
    pushChronicle(state, {
      title: `Завершён проект: ${project.title}`,
      text: `${project.reward ?? ""}${levelReward ? ` Уровень поселения: +${levelReward}.` : ""}`.trim(),
      type: "project"
    });
    await setState(state);
    return true;
  }

  async failProject(id) {
    if (!requireGM()) return false;
    const state = getState();
    const project = state.projects.find((entry) => entry.id === id);
    if (!project) return false;
    if (project.status !== "active") {
      ui.notifications.warn("Провалить можно только активный проект.");
      return false;
    }
    project.status = "failed";
    pushChronicle(state, {
      title: `Провален проект: ${project.title}`,
      text: "Уровень поселения не изменился.",
      type: "project"
    });
    await setState(state);
    return true;
  }

  async deleteProject(id) {
    if (!requireGM()) return false;
    const state = getState();
    state.projects = state.projects.filter((entry) => entry.id !== id);
    await setState(state);
    return true;
  }

  /* -------------------------------- Летопись -------------------------------- */

  async addChronicleEntry(data = {}) {
    if (!requireGM()) return false;
    const title = String(data.title ?? "").trim();
    if (!title) {
      ui.notifications.warn("Укажите заголовок записи.");
      return false;
    }
    const state = getState();
    pushChronicle(state, {
      date: String(data.date ?? "").trim() || undefined,
      title,
      text: String(data.text ?? "").trim(),
      type: "manual"
    });
    await setState(state);
    return true;
  }

  async reset() {
    if (!requireGM()) return false;
    await setState(cloneData(DEFAULT_STATE));
    ui.notifications.info("Settlement Manager: поселение сброшено к стартовым значениям.");
    return true;
  }
}

export const settlementService = new SettlementService();
