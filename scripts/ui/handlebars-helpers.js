/**
 * Шаблон модуля использует сравнивающие и логические хелперы (`eq`, `and`, …).
 * В API-документации Foundry 13 они не задокументированы, поэтому регистрируем
 * недостающие сами — уже существующие реализации не трогаем.
 */
export function registerHandlebarsHelpers() {
  if (typeof Handlebars === "undefined") return;

  const helpers = {
    eq: (a, b) => a === b,
    ne: (a, b) => a !== b,
    lt: (a, b) => a < b,
    gt: (a, b) => a > b,
    lte: (a, b) => a <= b,
    gte: (a, b) => a >= b,
    not: (a) => !a,
    and: (...args) => args.slice(0, -1).every(Boolean),
    or: (...args) => args.slice(0, -1).some(Boolean)
  };

  for (const [name, fn] of Object.entries(helpers)) {
    if (typeof Handlebars.helpers?.[name] !== "function") Handlebars.registerHelper(name, fn);
  }
}
