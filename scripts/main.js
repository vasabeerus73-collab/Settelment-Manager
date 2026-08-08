import { MODULE_ID } from "./core/constants.js";
import { applyCustomPacks, loadContent, useFallbackContent } from "./core/content-registry.js";
import { getPacks, registerSettings } from "./core/storage.js";
import { runMigrations } from "./core/migrations.js";
import { SettlementAPI, refreshSettlementApp } from "./api/public-api.js";
import { registerSettlementSocket } from "./integrations/socket.js";
import { registerHandlebarsHelpers } from "./ui/handlebars-helpers.js";

// Контент грузим до init: настройки используют DEFAULT_STATE как значение по
// умолчанию. Ошибка загрузки НЕ должна валить модуль целиком — иначе хук init
// не отработает, настройки не зарегистрируются и мир получит каскад ошибок.
let contentError = null;
try {
  await loadContent();
} catch (error) {
  contentError = error;
  console.error(`${MODULE_ID} | Не удалось загрузить базовый data-пакет.`, error);
  useFallbackContent();
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  registerHandlebarsHelpers();
  registerSettings(
    () => refreshSettlementApp(),
    () => {
      applyCustomPacks(getPacks());
      refreshSettlementApp();
    }
  );
});

Hooks.once("ready", async () => {
  // Порядок важен: миграции должны видеть ресурсы из паков,
  // иначе их ключи не попадут в состояние мира.
  const { errors } = applyCustomPacks(getPacks());
  await runMigrations();

  registerSettlementSocket();

  const module = game.modules.get(MODULE_ID);
  if (module) module.api = SettlementAPI;

  globalThis.Settlement = SettlementAPI;

  if (contentError) {
    ui.notifications.error(`Settlement Manager: не удалось загрузить встроенный контент (${contentError.message}). Модуль работает в аварийном режиме.`);
  }
  if (game.user?.isGM && errors.length) {
    ui.notifications.warn(`Settlement Manager: в контент-паках ${errors.length} проблем(ы). Подробности в консоли (F12).`);
  }

  if (game.user?.isGM) {
    await SettlementAPI.checkConstruction({ announce: false });
  }

  console.log(`${MODULE_ID} | ready`);
  console.log(`${MODULE_ID} | API: globalThis.Settlement / game.modules.get("${MODULE_ID}").api`);
});

Hooks.on("updateWorldTime", async () => {
  if (!game.user?.isGM) return;
  await SettlementAPI.checkConstruction({ announce: true });
});
