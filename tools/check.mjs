/**
 * Проверки dev-сборки без внешних зависимостей.
 * Запуск: npm run check
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const problems = [];

function fail(message) {
  problems.push(message);
  console.error(`  ✘ ${message}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* 1. Синтаксис всех скриптов */
const scripts = walk(path.join(root, "scripts")).filter((file) => file.endsWith(".js"));
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    fail(`синтаксис ${path.relative(root, file)}: ${error.stderr?.toString().split("\n")[0] ?? error.message}`);
  }
}
console.log(`  ✔ синтаксис: ${scripts.length} файлов`);

/* 2. Все JSON, включая data/buildings/ */
const jsonFiles = [...walk(path.join(root, "data")), path.join(root, "module.json"), path.join(root, "package.json")]
  .filter((file) => file.endsWith(".json"));
const parsed = new Map();
for (const file of jsonFiles) {
  try {
    parsed.set(file, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    fail(`JSON ${path.relative(root, file)}: ${error.message}`);
  }
}
console.log(`  ✔ JSON: ${parsed.size} файлов`);

/* 3. Согласованность контента */
const dataDir = path.join(root, "data");
const manifest = parsed.get(path.join(dataDir, "manifest.json"));
const resources = parsed.get(path.join(dataDir, "resources.json")) ?? {};
const defaultState = parsed.get(path.join(dataDir, "default-state.json")) ?? {};
const index = parsed.get(path.join(dataDir, "buildings", "index.json"));

if (!manifest) fail("нет data/manifest.json");
if (!Array.isArray(index)) fail("buildings/index.json должен быть массивом");

const onDisk = fs.readdirSync(path.join(dataDir, "buildings")).filter((f) => f.endsWith(".json") && f !== "index.json");
for (const file of onDisk) if (!index?.includes(file)) fail(`${file} не перечислен в buildings/index.json`);
for (const file of (index ?? [])) if (!onDisk.includes(file)) fail(`${file} указан в index.json, но отсутствует`);

const ids = new Set();
const buildingBonusTypes = new Set(["capacity", "defense", "restHealingPercent", "projectLevel"]);
for (const file of (index ?? [])) {
  const building = parsed.get(path.join(dataDir, "buildings", file));
  if (!building) continue;
  if (!building.id || !building.name) fail(`${file}: нет id или name`);
  if (ids.has(building.id)) fail(`${file}: повтор id «${building.id}»`);
  ids.add(building.id);

  const levels = (building.levels ?? []).map((level) => level.level);
  const expected = levels.map((_, i) => i + 1);
  if (JSON.stringify(levels) !== JSON.stringify(expected)) fail(`${file}: уровни должны идти 1..n, получено ${levels}`);

  for (const level of (building.levels ?? [])) {
    if (!(Number(level.durationDays) >= 1)) fail(`${file} ур.${level.level}: durationDays должен быть >= 1`);
    if (!Array.isArray(level.effects)) fail(`${file} ур.${level.level}: effects должен быть массивом`);
    if (level.bonuses !== undefined && !Array.isArray(level.bonuses)) fail(`${file} level ${level.level}: bonuses must be an array`);
    for (const bonus of (level.bonuses ?? [])) {
      if (!buildingBonusTypes.has(bonus.type)) fail(`${file} level ${level.level}: unknown bonus "${bonus.type}"`);
      if (!Number.isInteger(bonus.value) || bonus.value <= 0) fail(`${file} level ${level.level}: invalid bonus value ${bonus.value}`);
    }
    for (const [key, amount] of Object.entries(level.cost ?? {})) {
      if (!resources[key]) fail(`${file} ур.${level.level}: неизвестный ресурс «${key}»`);
      if (!Number.isInteger(amount) || amount < 0) fail(`${file} ур.${level.level}: неверная стоимость ${key}=${amount}`);
    }
  }
}
for (const key of Object.keys(resources)) {
  if (defaultState.resources?.[key] === undefined) fail(`default-state.json: нет стартового значения для ресурса «${key}»`);
}
for (const key of Object.keys(defaultState.resources ?? {})) {
  if (!resources[key]) fail(`default-state.json: ресурс «${key}» отсутствует в resources.json`);
}
console.log(`  ✔ контент: ${ids.size} построек, ${Object.keys(resources).length} ресурсов`);

/* 4. Баланс блоков Handlebars и наличие обработчиков для всех data-action */
const template = fs.readFileSync(path.join(root, "templates", "settlement.hbs"), "utf8");
const stack = [];
for (const match of template.matchAll(/\{\{([#/])(\w+)/g)) {
  if (match[1] === "#") stack.push(match[2]);
  else {
    const open = stack.pop();
    if (open !== match[2]) fail(`шаблон: {{/${match[2]}}} закрывает {{#${open ?? "—"}}}`);
  }
}
if (stack.length) fail(`шаблон: не закрыты блоки ${stack.join(", ")}`);

const appSource = fs.readFileSync(path.join(root, "scripts", "ui", "settlement-app.js"), "utf8");
const actionsBlock = appSource.match(/actions:\s*\{([\s\S]*?)\n {4}\}/)?.[1] ?? "";
const registered = new Set([...actionsBlock.matchAll(/(\w+):\s*SettlementApplication\./g)].map((m) => m[1]));
if (!registered.size) fail("не удалось разобрать блок actions в settlement-app.js");
const used = new Set([...template.matchAll(/data-action="([\w-]+)"/g)].map((m) => m[1]));
for (const action of used) if (!registered.has(action)) fail(`шаблон использует data-action="${action}", но обработчик не зарегистрирован`);
for (const action of registered) if (!used.has(action)) fail(`обработчик «${action}» зарегистрирован, но не используется в шаблоне`);
console.log(`  ✔ шаблон: блоки сбалансированы, ${used.size} действий связаны с обработчиками`);

/* 5. Версии module.json и package.json совпадают */
const moduleJson = parsed.get(path.join(root, "module.json"));
const packageJson = parsed.get(path.join(root, "package.json"));
if (moduleJson?.version !== packageJson?.version) {
  fail(`версии расходятся: module.json ${moduleJson?.version}, package.json ${packageJson?.version}`);
}
for (const file of moduleJson?.esmodules ?? []) {
  if (!fs.existsSync(path.join(root, file))) fail(`module.json ссылается на отсутствующий ${file}`);
}
for (const file of moduleJson?.styles ?? []) {
  if (!fs.existsSync(path.join(root, file))) fail(`module.json ссылается на отсутствующий ${file}`);
}
console.log(`  ✔ манифест: версия ${moduleJson?.version}, все файлы на месте`);


/* 6. Базовая вложенность HTML-тегов в основном шаблоне */
const htmlStack = [];
const voidTags = new Set(["input", "img", "br", "hr", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
const htmlTagRe = /<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*?)?\s*\/?>/g;
let htmlMatch;
while ((htmlMatch = htmlTagRe.exec(template))) {
  const raw = htmlMatch[0];
  const name = htmlMatch[1].toLowerCase();
  if (voidTags.has(name) || raw.endsWith("/>")) continue;
  if (raw.startsWith("</")) {
    const expected = htmlStack.pop();
    if (expected !== name) fail(`шаблон HTML: ожидался </${expected ?? "—"}>, найден </${name}>`);
  } else {
    htmlStack.push(name);
  }
}
if (htmlStack.length) fail(`шаблон HTML: не закрыты теги ${htmlStack.join(", ")}`);
console.log("  ✔ HTML: базовая вложенность тегов корректна");

if (problems.length) {
  console.error(`\nSettlement Manager checks FAILED: ${problems.length} проблем(ы).`);
  process.exit(1);
}
console.log("\nSettlement Manager checks passed.");
