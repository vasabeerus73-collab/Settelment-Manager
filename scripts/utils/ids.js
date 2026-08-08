
/**
 * Create a stable ASCII-ish identifier without relying on Foundry helper APIs.
 * Cyrillic text is preserved because JSON/world settings support Unicode keys.
 * @param {unknown} value
 * @param {string} fallbackPrefix
 * @returns {string}
 */
export function makeSlug(value, fallbackPrefix = "item") {
  const text = String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return text || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

export function uniqueId(base, existingIds = [], fallbackPrefix = "item") {
  const ids = new Set(existingIds);
  const root = makeSlug(base, fallbackPrefix);
  if (!ids.has(root)) return root;

  let index = 2;
  while (ids.has(`${root}-${index}`)) index += 1;
  return `${root}-${index}`;
}

export function requestId(prefix = "req") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Идентификатор записи состояния (летопись, просьба, проект). */
export function entryId(prefix = "sm") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
