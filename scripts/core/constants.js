export const MODULE_ID = "settlement-manager";
export const STATE_KEY = "state";
export const SECONDS_PER_DAY = 86400;

/** Летопись живёт в world-setting как строка JSON — ограничиваем её рост. */
export const MAX_CHRONICLE_ENTRIES = 500;

export { BUILDINGS, BLUEPRINTS, DEFAULT_STATE, RESOURCE_LABELS, RESOURCE_ICONS } from "./content-registry.js";

export const REQUEST_STATUS = {
  available: "Доступна",
  accepted: "Принята",
  complete: "Выполнена",
  failed: "Провалена"
};

export const ACCESS_VALUES = ["unlocked", "locked", "hidden"];

export const BUILDING_ACCESS = {
  unlocked: { label: "Открыто", icon: "fa-solid fa-lock-open" },
  locked: { label: "Нужен чертёж", icon: "fa-solid fa-lock" },
  hidden: { label: "Скрыто", icon: "fa-solid fa-eye-slash" }
};

export const PROJECT_STATUS = {
  available: "Доступен",
  active: "В работе",
  complete: "Завершён"
};
