import {
  BUILDING_ACCESS,
  MODULE_ID,
  PROJECT_STATUS,
  REQUEST_STATUS,
  RESOURCE_ICONS,
  RESOURCE_LABELS,
  SECONDS_PER_DAY
} from "../core/constants.js";
import { settlementService, normalizeBuildingState } from "../services/settlement-service.js";
import { requestConstruction, requestPlayerAction } from "../integrations/socket.js";
import { applyCustomPacks, getContentSnapshot } from "../core/content-registry.js";
import { getPacks, resetSettlementState, setPacks, setState } from "../core/storage.js";
import { makeSlug, uniqueId } from "../utils/ids.js";
import { attrValue, cloneData, escapeHTML, toCount } from "../utils/data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const GM_TABS = ["management", "resourceIntake", "dataEditor", "packs"];
const EDITOR_MODES = ["building", "resource", "blueprint"];
const DRAFT_LEVEL = { level: 1, durationDays: 3, cost: {}, effects: [] };

function resourceRows(resources) {
  return Object.entries(RESOURCE_LABELS).map(([key, label]) => ({
    key,
    label,
    value: toCount(resources?.[key]),
    icon: RESOURCE_ICONS[key] ?? "fa-solid fa-box"
  }));
}

function statusLabel(row) {
  if (row.isBuilding) return row.currentLevel > 0 ? "Улучшается" : "Строится";
  if (row.isMaxLevel) return "Макс. уровень";
  if (row.isComplete) return "Построено";
  return "Не построено";
}

function buildingRows(state, editable = false) {
  const now = Number(game.time?.worldTime ?? 0);
  const buildings = settlementService.getBuildings();
  const blueprintUnlocks = settlementService.getBlueprintUnlocks(state);

  return Object.values(buildings).map((definition) => {
    const current = normalizeBuildingState(definition.id, state.buildings?.[definition.id]);
    const rawAccess = settlementService.getBuildingAccess(definition.id, state);
    const effectiveAccess = settlementService.getEffectiveAccess(definition.id, state, blueprintUnlocks);
    const currentLevel = current.level;
    const nextLevel = definition.levels.find((entry) => Number(entry.level) === currentLevel + 1) ?? null;
    const maxLevel = Math.max(...definition.levels.map((entry) => Number(entry.level)));
    // Состояние передаём явно: иначе canBuild читал бы world-setting заново
    // для каждой постройки (два разбора JSON на строку списка).
    const check = settlementService.canBuild(definition.id, state);
    const status = current.status;
    const targetLevel = toCount(current.targetLevel ?? nextLevel?.level ?? currentLevel);
    const constructionLevel = definition.levels.find((entry) => Number(entry.level) === targetLevel) ?? nextLevel;
    const remainingSeconds = status === "building" ? Math.max(0, Number(current.completesAt ?? now) - now) : 0;
    const totalSeconds = Math.max(1, Number(constructionLevel?.durationDays ?? 1) * SECONDS_PER_DAY);
    const elapsedSeconds = status === "building" ? Math.max(0, now - Number(current.startedAt ?? now)) : 0;
    const price = status === "building" ? constructionLevel : nextLevel;
    const costs = Object.entries(price?.cost ?? {}).map(([resource, amount]) => {
      const have = toCount(state.resources?.[resource]);
      return {
        key: resource,
        label: RESOURCE_LABELS[resource] ?? resource,
        amount: toCount(amount),
        have,
        enough: have >= toCount(amount),
        icon: RESOURCE_ICONS[resource] ?? "fa-solid fa-box"
      };
    });

    const isMaxLevel = currentLevel >= maxLevel && status !== "building";
    const row = {
      ...definition,
      access: rawAccess,
      effectiveAccess,
      unlockedByBlueprint: rawAccess !== "unlocked" && effectiveAccess === "unlocked",
      accessLabel: BUILDING_ACCESS[effectiveAccess]?.label ?? effectiveAccess,
      accessIcon: BUILDING_ACCESS[effectiveAccess]?.icon ?? "fa-solid fa-lock-open",
      accessUnlocked: rawAccess === "unlocked",
      accessLocked: rawAccess === "locked",
      accessHidden: rawAccess === "hidden",
      isAccessLocked: effectiveAccess !== "unlocked" && currentLevel === 0,
      showAccessBadge: effectiveAccess !== "unlocked" && currentLevel === 0,
      hasInsufficientResources: effectiveAccess === "unlocked" && costs.some((cost) => !cost.enough),
      currentLevel,
      nextLevelNumber: nextLevel?.level ?? null,
      targetLevel,
      maxLevel,
      status,
      isBuilding: status === "building",
      isComplete: currentLevel > 0 && status !== "building",
      isMaxLevel,
      canStart: check.ok,
      reason: check.reason,
      daysRemaining: Math.ceil(remainingSeconds / SECONDS_PER_DAY),
      progressPercent: status === "building" ? Math.min(100, Math.max(0, (elapsedSeconds / totalSeconds) * 100)) : 0,
      costs,
      durationDays: price?.durationDays ?? 0,
      effects: price?.effects ?? (isMaxLevel ? definition.levels.at(-1)?.effects ?? [] : []),
      actionLabel: currentLevel === 0 ? "Построить" : `Улучшить до ${nextLevel?.level ?? maxLevel}`,
      categoryKey: buildingCategoryKey(definition.category)
    };
    row.statusLabel = statusLabel(row);
    return row;
  }).filter((row) => editable || row.currentLevel > 0 || row.effectiveAccess !== "hidden");
}

function moraleLabel(value) {
  const morale = Number(value ?? 0);
  if (morale >= 80) return "Воодушевлены";
  if (morale >= 60) return "Хорошая";
  if (morale >= 40) return "Стабильная";
  if (morale >= 20) return "Плохая";
  return "Ужасная";
}


function buildingCategoryKey(category) {
  const value = String(category ?? "").toLocaleLowerCase("ru-RU");
  if (value.includes("жизн")) return "life";
  if (value.includes("знан")) return "knowledge";
  if (value.includes("ремес")) return "craft";
  if (value.includes("защит") || value.includes("военн")) return "defense";
  if (value.includes("обществ") || value.includes("связ")) return "social";
  if (value.includes("управ")) return "government";
  if (value.includes("инфраструкт")) return "infrastructure";
  return "other";
}

function requestRows(state) {
  return (state.requests ?? []).map((entry) => ({
    ...entry,
    moraleReward: toCount(entry.moraleReward),
    moralePenalty: toCount(entry.moralePenalty),
    statusLabel: REQUEST_STATUS[entry.status] ?? entry.status,
    isAvailable: entry.status === "available",
    isAccepted: entry.status === "accepted",
    isComplete: entry.status === "complete",
    isFailed: entry.status === "failed"
  }));
}

function projectRows(state) {
  return (state.projects ?? []).map((entry) => {
    const requirements = Object.entries(entry.requirements ?? {})
      .filter(([, amount]) => toCount(amount) > 0)
      .map(([resource, amount]) => {
        const have = toCount(state.resources?.[resource]);
        return {
          key: resource,
          label: RESOURCE_LABELS[resource] ?? resource,
          icon: RESOURCE_ICONS[resource] ?? "fa-solid fa-box",
          amount: toCount(amount),
          have,
          enough: have >= toCount(amount)
        };
      });
    const check = settlementService.canStartProject(entry.id, state);
    return {
      ...entry,
      requirements,
      statusLabel: PROJECT_STATUS[entry.status] ?? entry.status,
      isAvailable: entry.status === "available",
      isActive: entry.status === "active",
      isComplete: entry.status === "complete",
      isFailed: entry.status === "failed",
      levelReward: toCount(entry.levelReward),
      canStart: check.ok,
      reason: check.reason
    };
  });
}

/** Сохраняет паки, пересобирает контент и показывает ошибки валидации ГМу. */
async function persistPacks(packs) {
  await setPacks(packs);
  const { errors } = applyCustomPacks(packs);
  for (const message of errors.slice(0, 3)) ui.notifications.warn(message);
  if (errors.length > 3) ui.notifications.warn(`…и ещё ${errors.length - 3} проблем(ы) в паках. Подробности в консоли.`);
  return errors;
}

export class SettlementApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  activeTab = "overview";
  selectedBuildingId = null;

  /** Режим правой панели Data Editor. Обязателен: без него панель пустая. */
  editorMode = "building";
  editorPackId = null;
  /**
   * undefined — «ещё не выбирали, подставь первый элемент»,
   * null — «создаём новый», строка — конкретный элемент.
   */
  editorBuildingId = undefined;
  editorBlueprintId = undefined;
  editorResourceId = undefined;

  static DEFAULT_OPTIONS = {
    id: "settlement-manager-window",
    classes: ["settlement-manager-window"],
    tag: "form",
    position: { width: 1240, height: 820 },
    window: {
      title: "Settlement Manager",
      icon: "fa-solid fa-house-chimney",
      resizable: true
    },
    form: {
      closeOnSubmit: false,
      submitOnChange: false,
      handler: SettlementApplication.onSubmit
    },
    actions: {
      switchTab: SettlementApplication.onSwitchTab,
      build: SettlementApplication.onBuild,
      check: SettlementApplication.onCheck,
      selectBuilding: SettlementApplication.onSelectBuilding,
      setBuildingAccess: SettlementApplication.onSetBuildingAccess,
      requestStatus: SettlementApplication.onRequestStatus,
      deleteRequest: SettlementApplication.onDeleteRequest,
      addRequest: SettlementApplication.onAddRequest,
      startProject: SettlementApplication.onStartProject,
      completeProject: SettlementApplication.onCompleteProject,
      failProject: SettlementApplication.onFailProject,
      deleteProject: SettlementApplication.onDeleteProject,
      addProject: SettlementApplication.onAddProject,
      addChronicle: SettlementApplication.onAddChronicle,
      quickAddResources: SettlementApplication.onQuickAddResources,
      createPack: SettlementApplication.onCreatePack,
      togglePack: SettlementApplication.onTogglePack,
      deletePack: SettlementApplication.onDeletePack,
      exportBundle: SettlementApplication.onExportBundle,
      importBundle: SettlementApplication.onImportBundle,
      factoryReset: SettlementApplication.onFactoryReset,
      selectEditorBuilding: SettlementApplication.onSelectEditorBuilding,
      saveCustomBuilding: SettlementApplication.onSaveCustomBuilding,
      deleteCustomBuilding: SettlementApplication.onDeleteCustomBuilding,
      addEditorLevel: SettlementApplication.onAddEditorLevel,
      removeEditorLevel: SettlementApplication.onRemoveEditorLevel,
      selectEditorBlueprint: SettlementApplication.onSelectEditorBlueprint,
      saveBlueprint: SettlementApplication.onSaveBlueprint,
      deleteBlueprint: SettlementApplication.onDeleteBlueprint,
      toggleBlueprintKnown: SettlementApplication.onToggleBlueprintKnown,
      saveResource: SettlementApplication.onSaveResource,
      deleteResource: SettlementApplication.onDeleteResource,
      selectEditorResource: SettlementApplication.onSelectEditorResource,
      cloneCoreBuilding: SettlementApplication.onCloneCoreBuilding,
      cloneCoreBlueprint: SettlementApplication.onCloneCoreBlueprint
    }
  };

  static PARTS = {
    main: { template: "modules/settlement-manager/templates/settlement.hbs" }
  };

  /**
   * Смена пака в <select> должна перерисовывать редактор: иначе форма
   * показывает данные одного пака, а сохранение уходит в другой.
   * Слушатель вешаем на сам узел (он пересоздаётся каждый рендер),
   * а не на this.element — делегирование копило бы обработчики.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const packSelect = this.element?.querySelector('[name="editor.packId"]');
    if (!packSelect || packSelect.dataset.smBound === "true") return;
    packSelect.dataset.smBound = "true";
    packSelect.addEventListener("change", async (event) => {
      this.editorPackId = event.currentTarget.value || null;
      this.editorBuildingId = undefined;
      this.editorBlueprintId = undefined;
      this.editorResourceId = undefined;
      await this.render({ force: true });
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // UI 2.2 merged the legacy requests/projects screens into one notice board.
    if (this.activeTab === "requests" || this.activeTab === "projects") this.activeTab = "board";
    const state = settlementService.getData();
    const editable = Boolean(game.user?.isGM);

    if (!editable && GM_TABS.includes(this.activeTab)) this.activeTab = "overview";
    if (!EDITOR_MODES.includes(this.editorMode)) this.editorMode = "building";

    const buildings = buildingRows(state, editable);
    if (!buildings.some((building) => building.id === this.selectedBuildingId)) {
      this.selectedBuildingId = buildings[0]?.id ?? null;
    }
    const selectedBuilding = buildings.find((building) => building.id === this.selectedBuildingId) ?? null;
    const activeConstruction = buildings.find((building) => building.isBuilding) ?? null;
    const requests = requestRows(state);
    const projects = projectRows(state);
    const chronicle = state.chronicle ?? [];
    const packs = editable ? getPacks() : [];

    const activeRequests = requests.filter((entry) => entry.isAvailable || entry.isAccepted);
    const activeProjects = projects.filter((entry) => entry.isAvailable || entry.isActive);
    const recentChronicle = chronicle.slice(-5).reverse();

    const completedBuildings = buildings.filter((entry) => entry.currentLevel > 0 && !entry.isBuilding).length;
    const availableBuildings = buildings.filter((entry) => entry.currentLevel === 0 && entry.effectiveAccess === "unlocked").length;
    const lockedBuildings = buildings.filter((entry) => entry.currentLevel === 0 && entry.effectiveAccess !== "unlocked").length;

    const morale = Number(state.morale ?? 0);
    const moraleTone = morale >= 80 ? "good" : morale >= 60 ? "positive" : morale >= 40 ? "neutral" : morale >= 20 ? "warning" : "danger";
    const populationRatio = toCount(state.population) / Math.max(1, toCount(state.capacity, 1));
    const populationTone = populationRatio >= 0.9 ? "warning" : populationRatio >= 0.7 ? "neutral" : "positive";

    const tabs = [
      { id: "overview", label: "О поселении", icon: "fa-solid fa-house" },
      { id: "buildings", label: "Постройки", icon: "fa-solid fa-hammer" },
      { id: "board", label: "Доска", icon: "fa-solid fa-thumbtack" },
      { id: "chronicle", label: "Летопись", icon: "fa-solid fa-book" }
    ];
    if (editable) {
      tabs.push({ id: "management", label: "Управление", icon: "fa-solid fa-gears" });
      tabs.push({ id: "resourceIntake", label: "Добавить ресурсы", icon: "fa-solid fa-cart-flatbed" });
      tabs.push({ id: "dataEditor", label: "Редактор данных", icon: "fa-solid fa-database" });
      tabs.push({ id: "packs", label: "Паки", icon: "fa-solid fa-boxes-stacked" });
    }
    for (const tab of tabs) tab.active = this.activeTab === tab.id;

    return {
      ...context,
      state,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "",
      editable,
      tabs,
      isOverview: this.activeTab === "overview",
      isBuildings: this.activeTab === "buildings",
      isBoard: this.activeTab === "board",
      isChronicle: this.activeTab === "chronicle",
      isManagement: this.activeTab === "management" && editable,
      isResourceIntake: this.activeTab === "resourceIntake" && editable,
      isDataEditor: this.activeTab === "dataEditor" && editable,
      isPacks: this.activeTab === "packs" && editable,
      contentPacks: packs,
      hasCustomPacks: packs.length > 0,
      editor: editable ? this._prepareEditorContext(packs, state) : null,
      resources: resourceRows(state.resources),
      buildings: buildings.map((building) => ({ ...building, isSelected: building.id === selectedBuilding?.id })),
      selectedBuilding,
      activeConstruction,
      hasActiveConstruction: Boolean(activeConstruction),
      requests,
      projects,
      chronicle,
      dashboard: {
        activeRequests,
        activeProjects,
        recentChronicle,
        activeRequestCount: activeRequests.length,
        activeProjectCount: activeProjects.length,
        completedBuildings,
        availableBuildings,
        lockedBuildings,
        moraleTone,
        populationTone
      },
      moralePercent: Math.min(100, Math.max(0, Number(state.morale ?? 0))),
      moraleLabel: moraleLabel(state.morale),
      populationPercent: Math.min(100, Math.max(0, (toCount(state.population) / Math.max(1, toCount(state.capacity, 1))) * 100))
    };
  }

  /**
   * Выбирает элемент редактора.
   * `undefined` — берём первый доступный, `null` — режим создания (пустая форма).
   */
  _resolveSelection(items, currentId, apply) {
    if (currentId === undefined) {
      const first = items[0] ?? null;
      apply(first?.id ?? null);
      return first;
    }
    if (currentId === null) return null;
    const found = items.find((item) => item.id === currentId) ?? null;
    if (!found) apply(null);
    return found;
  }

  _prepareEditorContext(packs, state) {
    const selectedPack = packs.find((pack) => pack.id === this.editorPackId) ?? packs[0] ?? null;
    this.editorPackId = selectedPack?.id ?? null;

    const customBuildings = selectedPack?.buildings ?? [];
    const customBlueprints = selectedPack?.blueprints ?? [];
    const customResources = selectedPack?.resources ?? [];

    const selectedBuilding = this._resolveSelection(customBuildings, this.editorBuildingId, (id) => { this.editorBuildingId = id; });
    const selectedBlueprint = this._resolveSelection(customBlueprints, this.editorBlueprintId, (id) => { this.editorBlueprintId = id; });
    const selectedResource = this._resolveSelection(customResources, this.editorResourceId, (id) => { this.editorResourceId = id; });

    const resources = Object.entries(RESOURCE_LABELS).map(([id, label]) => ({
      id, label, icon: RESOURCE_ICONS[id] ?? "fa-solid fa-box"
    }));

    // Один снимок на рендер: getContentSnapshot() глубоко копирует весь контент.
    const snapshot = getContentSnapshot();
    const snapshotBuildings = Object.values(snapshot.buildings ?? {});
    const customBuildingIds = new Set(packs.flatMap((pack) => (pack.buildings ?? []).map((b) => b.id)));
    const coreBuildings = snapshotBuildings
      .filter((building) => !customBuildingIds.has(building.id))
      .map((building) => ({ id: building.id, name: building.name, category: building.category, icon: building.icon }));

    const customResourceIds = new Set(packs.flatMap((pack) => (pack.resources ?? []).map((r) => r.id)));
    const coreResources = Object.values(snapshot.resources ?? {})
      .filter((resource) => !customResourceIds.has(resource.id))
      .map((resource) => ({ id: resource.id, label: resource.label, icon: resource.icon }));

    // Для новой постройки показываем черновой уровень 1, чтобы стоимость
    // и срок можно было задать сразу, а не после первого сохранения.
    const levelSource = selectedBuilding?.levels?.length ? selectedBuilding.levels : [DRAFT_LEVEL];
    const selectedBuildingLevels = levelSource.map((level) => ({
      ...cloneData(level),
      costs: resources.map((resource) => ({
        id: resource.id,
        label: resource.label,
        icon: resource.icon,
        value: toCount(level.cost?.[resource.id])
      })),
      effectsText: Array.isArray(level.effects) ? level.effects.join("\n") : ""
    }));

    const blueprintBuildingOptions = snapshotBuildings.map((building) => ({
      id: building.id,
      name: building.name,
      selected: selectedBlueprint?.unlocks?.includes(building.id) ?? false
    }));

    const knownIds = new Set(state.blueprints ?? []);
    const knownBlueprints = Object.values(settlementService.getBlueprints())
      .filter((blueprint) => knownIds.has(blueprint.id))
      .map((blueprint) => ({ id: blueprint.id, name: blueprint.name }));

    return {
      selectedPackId: selectedPack?.id ?? "",
      selectedPack,
      buildings: customBuildings,
      selectedBuilding,
      selectedBuildingLevels,
      isNewBuilding: !selectedBuilding,
      blueprints: customBlueprints,
      selectedBlueprint,
      isNewBlueprint: !selectedBlueprint,
      selectedBlueprintKnown: selectedBlueprint ? settlementService.isBlueprintKnown(selectedBlueprint.id, state) : false,
      knownBlueprints,
      resources: customResources,
      selectedResource,
      isNewResource: !selectedResource,
      availableResources: resources,
      blueprintBuildingOptions,
      coreBuildings,
      coreResources,
      mode: this.editorMode,
      isBuildingMode: this.editorMode === "building",
      isResourceMode: this.editorMode === "resource",
      isBlueprintMode: this.editorMode === "blueprint"
    };
  }

  /* ------------------------------ Общие действия ---------------------------- */

  static async onSubmit(event, form, formData) {
    if (!game.user?.isGM) return;
    // Enter в любом текстовом поле отправляет форму. Сохранять параметры
    // поселения имеет смысл только со вкладки «Управление».
    if (this.activeTab !== "management") return;

    const data = formData?.object
      ?? foundry.utils.expandObject(Object.fromEntries(formData?.entries?.() ?? []));

    await settlementService.updateCore({
      name: data.name,
      description: data.description,
      level: data.level,
      population: data.population,
      capacity: data.capacity,
      morale: data.morale,
      defense: data.defense,
      resources: data.resources ?? {}
    });
    ui.notifications.info("Поселение сохранено.");
    await this.render({ force: true });
  }

  static async onSwitchTab(event, target) {
    this.activeTab = target.dataset.tab;
    await this.render({ force: true });
  }

  static async onBuild(event, target) {
    this.selectedBuildingId = target.dataset.buildingId;
    await requestConstruction(this.selectedBuildingId);
    await this.render({ force: true });
  }

  static async onCheck() {
    const completed = await settlementService.checkConstruction();
    if (!completed.length) ui.notifications.info("Новых завершённых построек нет.");
    await this.render({ force: true });
  }

  static async onSelectBuilding(event, target) {
    this.selectedBuildingId = target.dataset.buildingId;
    await this.render({ force: true });
  }

  static async onSetBuildingAccess(event, target) {
    await settlementService.setBuildingAccess(target.dataset.buildingId, target.dataset.access);
    await this.render({ force: true });
  }

  /* --------------------------- Просьбы и проекты ---------------------------- */

  static async onRequestStatus(event, target) {
    if (target.dataset.status === "accepted") {
      await requestPlayerAction("accept-request", target.dataset.requestId);
    } else {
      await settlementService.setRequestStatus(target.dataset.requestId, target.dataset.status);
    }
    await this.render({ force: true });
  }

  static async onDeleteRequest(event, target) {
    await settlementService.deleteRequest(target.dataset.requestId);
    await this.render({ force: true });
  }


  static async onQuickAddResources() {
    if (!game.user?.isGM) return;

    const additions = {};
    for (const key of Object.keys(RESOURCE_LABELS)) {
      const input = this.element?.querySelector(`[name="quickResources.${key}"]`);
      const amount = toCount(input?.value);
      if (amount > 0) additions[key] = amount;
    }

    const result = await settlementService.addResources(additions);
    if (!result) return;

    for (const key of Object.keys(RESOURCE_LABELS)) {
      const input = this.element?.querySelector(`[name="quickResources.${key}"]`);
      if (input) input.value = "0";
    }

    await this.render({ force: true });
  }

  static async onAddRequest() {
    const root = this.element;
    const created = await settlementService.addRequest({
      title: root.querySelector('[name="newRequest.title"]')?.value,
      requester: root.querySelector('[name="newRequest.requester"]')?.value,
      description: root.querySelector('[name="newRequest.description"]')?.value,
      reward: root.querySelector('[name="newRequest.reward"]')?.value,
      moraleReward: root.querySelector('[name="newRequest.moraleReward"]')?.value,
      moralePenalty: root.querySelector('[name="newRequest.moralePenalty"]')?.value
    });
    if (created) ui.notifications.info("Просьба добавлена.");
    await this.render({ force: true });
  }

  static async onStartProject(event, target) {
    await requestPlayerAction("start-project", target.dataset.projectId);
    await this.render({ force: true });
  }

  static async onCompleteProject(event, target) {
    await settlementService.completeProject(target.dataset.projectId);
    await this.render({ force: true });
  }

  static async onFailProject(event, target) {
    await settlementService.failProject(target.dataset.projectId);
    await this.render({ force: true });
  }

  static async onDeleteProject(event, target) {
    await settlementService.deleteProject(target.dataset.projectId);
    await this.render({ force: true });
  }

  static async onAddProject() {
    const root = this.element;
    const requirements = {};
    for (const key of Object.keys(RESOURCE_LABELS)) {
      requirements[key] = root.querySelector(`[name="newProject.${attrValue(key)}"]`)?.value ?? 0;
    }
    const created = await settlementService.addProject({
      title: root.querySelector('[name="newProject.title"]')?.value,
      description: root.querySelector('[name="newProject.description"]')?.value,
      reward: root.querySelector('[name="newProject.reward"]')?.value,
      levelReward: root.querySelector('[name="newProject.levelReward"]')?.value,
      requirements
    });
    if (created) ui.notifications.info("Проект добавлен.");
    await this.render({ force: true });
  }

  static async onAddChronicle() {
    const root = this.element;
    const created = await settlementService.addChronicleEntry({
      date: root.querySelector('[name="newChronicle.date"]')?.value,
      title: root.querySelector('[name="newChronicle.title"]')?.value,
      text: root.querySelector('[name="newChronicle.text"]')?.value
    });
    if (created) ui.notifications.info("Запись добавлена в летопись.");
    await this.render({ force: true });
  }

  /* ---------------------------------- Паки ---------------------------------- */

  static async onCreatePack() {
    if (!game.user?.isGM) return;
    const nameInput = this.element?.querySelector('[name="pack.name"]');
    const descriptionInput = this.element?.querySelector('[name="pack.description"]');
    const name = String(nameInput?.value ?? "").trim();
    const description = String(descriptionInput?.value ?? "").trim();
    if (!name) {
      ui.notifications.warn("Укажите название пака.");
      nameInput?.focus();
      return;
    }

    const packs = getPacks();
    const id = uniqueId(name, packs.map((pack) => pack.id), "pack");
    packs.push({ id, name, description, enabled: true, buildings: [], resources: [], projects: [], requests: [], blueprints: [] });

    await persistPacks(packs);
    this.editorPackId = id;
    this.editorBuildingId = undefined;
    this.editorBlueprintId = undefined;
    this.editorResourceId = undefined;

    if (nameInput) nameInput.value = "";
    if (descriptionInput) descriptionInput.value = "";

    ui.notifications.info(`Создан пак «${name}».`);
    await this.render({ force: true });
  }

  static async onTogglePack(event, target) {
    if (!game.user?.isGM) return;
    const packs = getPacks();
    const pack = packs.find((entry) => entry.id === target.dataset.packId);
    if (!pack) return;
    pack.enabled = !pack.enabled;
    await persistPacks(packs);
    await this.render({ force: true });
  }

  static async onDeletePack(event, target) {
    if (!game.user?.isGM) return;
    const packs = getPacks();
    const pack = packs.find((entry) => entry.id === target.dataset.packId);
    if (!pack) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить пак" },
      content: `<p>Удалить пользовательский пак <strong>${escapeHTML(pack.name)}</strong>?</p>`,
      yes: { label: "Удалить" },
      no: { label: "Отмена" }
    });
    if (!confirmed) return;
    const next = packs.filter((entry) => entry.id !== pack.id);
    await persistPacks(next);
    if (this.editorPackId === pack.id) {
      this.editorPackId = null;
      this.editorBuildingId = undefined;
      this.editorBlueprintId = undefined;
      this.editorResourceId = undefined;
    }
    ui.notifications.info(`Пак «${pack.name}» удалён.`);
    await this.render({ force: true });
  }

  /* ------------------------------ Редактор данных --------------------------- */

  /** Пак редактора: сначала из <select>, затем из состояния окна. */
  _editorPack(packs, selectorName = "editor.packId") {
    const fromForm = this.element?.querySelector(`[name="${selectorName}"]`)?.value;
    const packId = fromForm || this.editorPackId;
    return packs.find((pack) => pack.id === packId) ?? null;
  }

  static async onSelectEditorBuilding(event, target) {
    this.editorPackId = target.dataset.packId || this.editorPackId;
    this.editorBuildingId = target.dataset.buildingId || null;
    this.editorMode = "building";
    await this.render({ force: true });
  }

  static async onSelectEditorBlueprint(event, target) {
    this.editorPackId = target.dataset.packId || this.editorPackId;
    this.editorBlueprintId = target.dataset.blueprintId || null;
    this.editorMode = "blueprint";
    await this.render({ force: true });
  }

  static async onSelectEditorResource(event, target) {
    this.editorPackId = target.dataset.packId || this.editorPackId;
    this.editorResourceId = target.dataset.resourceId || null;
    this.editorMode = "resource";
    await this.render({ force: true });
  }

  /** Считывает один уровень постройки из полей формы. */
  static _collectLevelFromElement(root, index, order) {
    const cost = {};
    for (const key of Object.keys(RESOURCE_LABELS)) {
      const value = toCount(root.querySelector(`[name="editor.level.${index}.cost.${attrValue(key)}"]`)?.value);
      if (value > 0) cost[key] = value;
    }
    const effects = String(root.querySelector(`[name="editor.level.${index}.effects"]`)?.value ?? "")
      .split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      level: order + 1,
      durationDays: Math.max(1, toCount(root.querySelector(`[name="editor.level.${index}.duration"]`)?.value, 1) || 1),
      cost,
      effects
    };
  }

  static async onSaveCustomBuilding() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs);
    if (!pack) return ui.notifications.warn("Выберите пользовательский пак.");

    const name = String(root.querySelector('[name="editor.name"]')?.value ?? "").trim();
    if (!name) return ui.notifications.warn("Укажите название постройки.");

    let id = String(root.querySelector('[name="editor.id"]')?.value ?? "").trim();
    if (!id) id = uniqueId(name, (pack.buildings ?? []).map((building) => building.id), "building");

    const levelNodes = [...root.querySelectorAll("[data-editor-level-index]")];
    // Пустая форма новой постройки тоже должна сохраняться — с базовым уровнем.
    const levels = levelNodes.length
      ? levelNodes.map((node, order) => this.constructor._collectLevelFromElement(root, Number(node.dataset.editorLevelIndex ?? order), order))
      : [cloneData(DRAFT_LEVEL)];

    const building = {
      id,
      name,
      icon: String(root.querySelector('[name="editor.icon"]')?.value ?? "").trim() || "fa-solid fa-building",
      category: String(root.querySelector('[name="editor.category"]')?.value ?? "").trim() || "Прочее",
      description: String(root.querySelector('[name="editor.description"]')?.value ?? "").trim(),
      maxLevel: levels.length,
      levels
    };

    pack.buildings ??= [];
    const existing = pack.buildings.findIndex((entry) => entry.id === id);
    if (existing >= 0) pack.buildings[existing] = building;
    else pack.buildings.push(building);

    const errors = await persistPacks(packs);
    this.editorPackId = pack.id;
    this.editorBuildingId = id;
    this.editorMode = "building";
    if (!errors.length) ui.notifications.info(`Постройка «${name}» сохранена.`);
    await this.render({ force: true });
  }

  static async onDeleteCustomBuilding() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs);
    const id = root.querySelector('[name="editor.id"]')?.value || this.editorBuildingId;
    const building = pack?.buildings?.find((entry) => entry.id === id);
    if (!pack || !building) return;

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить постройку" },
      content: `<p>Удалить <strong>${escapeHTML(building.name)}</strong> из пользовательского пака?</p>`,
      yes: { label: "Удалить" }, no: { label: "Отмена" }
    });
    if (!ok) return;

    pack.buildings = pack.buildings.filter((entry) => entry.id !== id);
    for (const blueprint of (pack.blueprints ?? [])) {
      blueprint.unlocks = (blueprint.unlocks ?? []).filter((entry) => entry !== id);
    }
    await persistPacks(packs);
    this.editorBuildingId = undefined;
    ui.notifications.info(`Постройка «${building.name}» удалена.`);
    await this.render({ force: true });
  }

  static async onAddEditorLevel() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs);
    const id = root.querySelector('[name="editor.id"]')?.value || this.editorBuildingId;
    const building = pack?.buildings?.find((entry) => entry.id === id);
    if (!building) return ui.notifications.warn("Сначала сохраните постройку.");
    building.levels ??= [];
    building.levels.push({ ...cloneData(DRAFT_LEVEL), level: building.levels.length + 1 });
    building.maxLevel = building.levels.length;
    await persistPacks(packs);
    await this.render({ force: true });
  }

  static async onRemoveEditorLevel(event, target) {
    if (!game.user?.isGM) return;
    const index = Number(target.dataset.levelIndex);
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs);
    const id = root.querySelector('[name="editor.id"]')?.value || this.editorBuildingId;
    const building = pack?.buildings?.find((entry) => entry.id === id);
    if (!building || !Array.isArray(building.levels) || building.levels.length <= 1) {
      return ui.notifications.warn("У постройки должен остаться хотя бы один уровень.");
    }
    if (!Number.isInteger(index) || index < 0 || index >= building.levels.length) return;
    building.levels.splice(index, 1);
    building.levels.forEach((level, order) => { level.level = order + 1; });
    building.maxLevel = building.levels.length;
    await persistPacks(packs);
    await this.render({ force: true });
  }

  /* --------------------------------- Чертежи -------------------------------- */

  static async onSaveBlueprint() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs, "blueprint.packId");
    if (!pack) return ui.notifications.warn("Выберите пользовательский пак.");

    const name = String(root.querySelector('[name="blueprint.name"]')?.value ?? "").trim();
    if (!name) return ui.notifications.warn("Укажите название чертежа.");
    let id = String(root.querySelector('[name="blueprint.id"]')?.value ?? "").trim();
    if (!id) id = uniqueId(name, (pack.blueprints ?? []).map((entry) => entry.id), "blueprint");

    // Фильтруем по свойству .checked, а не по CSS-псевдоклассу :checked —
    // псевдокласс опирается на атрибут и не видит пользовательский выбор.
    const unlocks = [...root.querySelectorAll('[name="blueprint.unlocks"]')]
      .filter((node) => node.checked)
      .map((node) => node.value);

    const blueprint = {
      id,
      name,
      description: String(root.querySelector('[name="blueprint.description"]')?.value ?? "").trim(),
      unlocks
    };

    pack.blueprints ??= [];
    const existing = pack.blueprints.findIndex((entry) => entry.id === id);
    if (existing >= 0) pack.blueprints[existing] = blueprint;
    else pack.blueprints.push(blueprint);

    await persistPacks(packs);
    this.editorPackId = pack.id;
    this.editorBlueprintId = id;
    this.editorMode = "blueprint";
    ui.notifications.info(`Чертёж «${name}» сохранён.`);
    await this.render({ force: true });
  }

  static async onDeleteBlueprint() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs, "blueprint.packId");
    const id = root.querySelector('[name="blueprint.id"]')?.value || this.editorBlueprintId;
    const blueprint = pack?.blueprints?.find((entry) => entry.id === id);
    if (!pack || !blueprint) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить чертёж" },
      content: `<p>Удалить <strong>${escapeHTML(blueprint.name)}</strong>?</p>`,
      yes: { label: "Удалить" }, no: { label: "Отмена" }
    });
    if (!ok) return;
    pack.blueprints = pack.blueprints.filter((entry) => entry.id !== id);
    await persistPacks(packs);
    this.editorBlueprintId = undefined;
    ui.notifications.info(`Чертёж «${blueprint.name}» удалён.`);
    await this.render({ force: true });
  }

  /** Выдать/отозвать чертёж: именно это делает режим «Нужен чертёж» рабочим. */
  static async onToggleBlueprintKnown(event, target) {
    if (!game.user?.isGM) return;
    const id = target.dataset.blueprintId || this.editorBlueprintId;
    if (!id) return;
    await settlementService.setBlueprintKnown(id, !settlementService.isBlueprintKnown(id));
    await this.render({ force: true });
  }

  /* --------------------------------- Ресурсы -------------------------------- */

  static async onSaveResource() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs, "resource.packId");
    if (!pack) return ui.notifications.warn("Выберите пользовательский пак.");

    const label = String(root.querySelector('[name="resource.label"]')?.value ?? "").trim();
    if (!label) return ui.notifications.warn("Укажите название ресурса.");

    let id = String(root.querySelector('[name="resource.id"]')?.value ?? "").trim();
    if (!id) id = uniqueId(label, (pack.resources ?? []).map((entry) => entry.id), "resource");
    const icon = String(root.querySelector('[name="resource.icon"]')?.value ?? "").trim() || "fa-solid fa-box";

    pack.resources ??= [];
    const existing = pack.resources.findIndex((entry) => entry.id === id);
    const resource = { id, label, icon };
    if (existing >= 0) pack.resources[existing] = resource;
    else pack.resources.push(resource);

    await persistPacks(packs);
    this.editorResourceId = id;
    this.editorMode = "resource";

    // Ключ нового ресурса должен появиться в стейте, иначе арифметика стоимости
    // получит undefined и превратит запас в NaN. getData() уже добавляет
    // недостающие ключи — остаётся зафиксировать их в мире.
    await setState(settlementService.getData());

    ui.notifications.info(`Ресурс «${label}» сохранён.`);
    await this.render({ force: true });
  }

  static async onDeleteResource() {
    if (!game.user?.isGM) return;
    const root = this.element;
    const packs = getPacks();
    const pack = this._editorPack(packs, "resource.packId");
    const id = root.querySelector('[name="resource.id"]')?.value || this.editorResourceId;
    const resource = pack?.resources?.find((entry) => entry.id === id);
    if (!pack || !resource) return;

    const usedBy = [];
    for (const entry of packs) {
      for (const building of (entry.buildings ?? [])) {
        if ((building.levels ?? []).some((level) => toCount(level.cost?.[id]) > 0)) usedBy.push(`постройка «${building.name}»`);
      }
      for (const project of (entry.projects ?? [])) {
        if (toCount(project.cost?.[id]) > 0 || toCount(project.requirements?.[id]) > 0) {
          usedBy.push(`проект «${project.title ?? project.name}»`);
        }
      }
    }
    if (usedBy.length) {
      return ui.notifications.warn(`Ресурс используется: ${usedBy.slice(0, 3).join(", ")}${usedBy.length > 3 ? "…" : ""}. Сначала уберите его из стоимости.`);
    }

    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить ресурс" },
      content: `<p>Удалить пользовательский ресурс <strong>${escapeHTML(resource.label)}</strong>?</p>`,
      yes: { label: "Удалить" }, no: { label: "Отмена" }
    });
    if (!ok) return;

    pack.resources = pack.resources.filter((entry) => entry.id !== id);
    await persistPacks(packs);
    this.editorResourceId = undefined;
    ui.notifications.info(`Ресурс «${resource.label}» удалён. Накопленное количество остаётся в состоянии мира.`);
    await this.render({ force: true });
  }

  /* ------------------------------- Клонирование ----------------------------- */

  static async onCloneCoreBuilding(event, target) {
    if (!game.user?.isGM) return;
    const packs = getPacks();
    if (!packs.length) return ui.notifications.warn("Сначала создайте пользовательский пак.");

    const source = getContentSnapshot().buildings?.[target.dataset.buildingId];
    if (!source) return ui.notifications.error("Исходная постройка не найдена.");

    const targetPackId = this.element.querySelector('[name="clone.buildingPackId"]')?.value || packs[0].id;
    const pack = packs.find((entry) => entry.id === targetPackId);
    if (!pack) return;

    pack.buildings ??= [];
    const clone = cloneData(source);
    const existing = pack.buildings.findIndex((entry) => entry.id === clone.id);
    if (existing >= 0) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Переопределить постройку" },
        content: `<p>В паке уже есть постройка с ID <strong>${escapeHTML(clone.id)}</strong>. Заменить её клоном?</p>`,
        yes: { label: "Заменить" }, no: { label: "Отмена" }
      });
      if (!ok) return;
      pack.buildings[existing] = clone;
    } else {
      pack.buildings.push(clone);
    }

    await persistPacks(packs);
    this.editorPackId = pack.id;
    this.editorBuildingId = clone.id;
    this.editorMode = "building";
    ui.notifications.info(`«${clone.name}» клонирована в пак «${pack.name}».`);
    await this.render({ force: true });
  }

  static async onCloneCoreBlueprint(event, target) {
    if (!game.user?.isGM) return;
    const packs = getPacks();
    if (!packs.length) return ui.notifications.warn("Сначала создайте пользовательский пак.");

    const buildingId = String(target.dataset.buildingId ?? "");
    const building = getContentSnapshot().buildings?.[buildingId];
    if (!building) return ui.notifications.warn("Постройка для чертежа не найдена.");

    const source = {
      id: `bp-${makeSlug(buildingId, "blueprint")}`,
      name: `Чертёж: ${building.name}`,
      description: `Открывает постройку «${building.name}».`,
      unlocks: [buildingId]
    };

    const targetPackId = this.element.querySelector('[name="clone.blueprintPackId"]')?.value || packs[0].id;
    const pack = packs.find((entry) => entry.id === targetPackId);
    if (!pack) return;

    pack.blueprints ??= [];
    const existing = pack.blueprints.findIndex((entry) => entry.id === source.id);
    if (existing >= 0) pack.blueprints[existing] = source;
    else pack.blueprints.push(source);

    await persistPacks(packs);
    this.editorPackId = pack.id;
    this.editorBlueprintId = source.id;
    this.editorMode = "blueprint";
    ui.notifications.info(`Чертёж «${source.name}» добавлен в пак «${pack.name}».`);
    await this.render({ force: true });
  }

  /* ----------------------------- Экспорт / импорт --------------------------- */

  static async onExportBundle() {
    if (!game.user?.isGM) return;
    const payload = {
      format: "settlement-manager-bundle",
      version: 1,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "",
      exportedAt: new Date().toISOString(),
      state: settlementService.getData(),
      packs: getPacks()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `settlement-manager-${game.world?.id ?? "world"}-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      // Освобождаем blob после того, как браузер забрал его для скачивания.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    ui.notifications.info("Экспорт Settlement Manager создан.");
  }

  static async onImportBundle() {
    if (!game.user?.isGM) return;
    const field = this.element.querySelector('[name="import.bundle"]');
    const raw = String(field?.value ?? "").trim();
    if (!raw) return ui.notifications.warn("Вставьте JSON экспорта.");
    try {
      const bundle = JSON.parse(raw);
      if (bundle?.format !== "settlement-manager-bundle") throw new Error("Файл не является экспортом Settlement Manager.");
      if (bundle.packs !== undefined && !Array.isArray(bundle.packs)) throw new Error("Поле packs должно быть массивом.");
      if (bundle.state !== undefined && (!bundle.state || typeof bundle.state !== "object" || Array.isArray(bundle.state))) {
        throw new Error("Поле state должно быть объектом.");
      }

      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Импорт Settlement Manager" },
        content: "<p>Импорт заменит текущее состояние поселения и список паков. Продолжить?</p>",
        yes: { label: "Импортировать" }, no: { label: "Отмена" }
      });
      if (!ok) return;

      if (Array.isArray(bundle.packs)) await persistPacks(bundle.packs);
      if (bundle.state) await setState(bundle.state);
      if (field) field.value = "";
      ui.notifications.info("Импорт завершён.");
      await this.render({ force: true });
    } catch (error) {
      console.error("settlement-manager | Import failed", error);
      ui.notifications.error(`Ошибка импорта: ${error.message}`);
    }
  }

  /* -------------------------------- Сброс мира ------------------------------ */

  static async onFactoryReset() {
    if (!game.user?.isGM) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Сбросить состояние поселения" },
      content: `
        <div class="sm-reset-confirm">
          <p><strong>Вернуть поселение к заводскому состоянию?</strong></p>
          <p>Будут сброшены:</p>
          <ul>
            <li>название, уровень, население, вместимость, мораль и ресурсы;</li>
            <li>построенные здания и активное строительство;</li>
            <li>доступность зданий и найденные чертежи;</li>
            <li>просьбы жителей, проекты и летопись.</li>
          </ul>
          <p><strong>Не будут удалены:</strong> пользовательские паки, пользовательские ресурсы,
          здания, чертежи и другой контент Data Editor.</p>
          <p class="sm-danger-text">Это действие нельзя отменить, если заранее не сделать экспорт.</p>
        </div>`,
      yes: { label: "Сбросить поселение", icon: "fa-solid fa-triangle-exclamation" },
      no: { label: "Отмена" }
    });

    if (!confirmed) return;

    try {
      await resetSettlementState();

      // Паки хранятся отдельно от состояния — пересобираем контент из них.
      applyCustomPacks(getPacks());

      this.selectedBuildingId = null;
      this.activeTab = "overview";

      ui.notifications.info("Settlement Manager: состояние поселения сброшено. Пользовательские паки сохранены.");
      await this.render({ force: true });
    } catch (error) {
      console.error("settlement-manager | Factory reset failed", error);
      ui.notifications.error(`Не удалось сбросить поселение: ${error.message}`);
    }
  }
}
