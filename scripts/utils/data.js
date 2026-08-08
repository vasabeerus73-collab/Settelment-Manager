export function cloneData(value) {
  if (value === undefined) return undefined;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

export function deepMerge(base, override) {
  const result = cloneData(base ?? {});
  if (!override || typeof override !== "object" || Array.isArray(override)) return result;

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = cloneData(value);
    }
  }
  return result;
}

/**
 * Целое число >= 0. Мусор, NaN, Infinity и отрицательные значения дают fallback.
 * Единственная точка нормализации количеств — ресурсы и уровни не должны уходить в NaN.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function toCount(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

/**
 * Экранирует значение для подстановки внутрь `[name="..."]`.
 * CSS.escape здесь не подходит: он экранирует идентификаторы, а не строки.
 * @param {unknown} value
 * @returns {string}
 */
export function attrValue(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

/**
 * Безопасный escapeHTML — не зависит от наличия foundry.utils.escapeHTML.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHTML(value) {
  const text = String(value ?? "");
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") return foundry.utils.escapeHTML(text);
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
