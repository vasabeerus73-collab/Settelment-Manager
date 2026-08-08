import { MODULE_ID } from "../core/constants.js";
import { settlementService } from "../services/settlement-service.js";
import { requestId as makeRequestId } from "../utils/ids.js";

const CHANNEL = `module.${MODULE_ID}`;
const REQUEST_TIMEOUT_MS = 8000;

/** requestId -> { resolve, timer } */
const pending = new Map();
let socketRegistered = false;

function primaryActiveGM() {
  const gms = [];
  for (const user of (game.users ?? [])) {
    if (user?.active && user?.isGM) gms.push(user);
  }
  return gms.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

/** Снимает таймаут и отдаёт результат ожидающему промису. */
function settle(id, message) {
  const waiter = pending.get(id);
  if (!waiter) return;
  pending.delete(id);
  clearTimeout(waiter.timer);
  waiter.resolve(message);
}

export function registerSettlementSocket() {
  // Повторный вызов не должен вешать второй обработчик:
  // иначе каждое сообщение обрабатывалось бы дважды.
  if (socketRegistered) return;
  socketRegistered = true;

  game.socket.on(CHANNEL, async (message) => {
    if (!message || typeof message !== "object") return;

    // Игрок не просит разрешение. Активный GM-клиент выступает только
    // доверенным владельцем world-setting и автоматически выполняет действие.
    if (message.type === "construction-execute") {
      const gm = primaryActiveGM();
      if (!game.user?.isGM || !gm || gm.id !== game.user.id) return;

      const user = game.users.get(message.userId);
      const building = settlementService.getBuilding(message.buildingId);
      let ok = false;
      let reason = "Некорректный запрос на строительство.";

      if (user && building) {
        const check = settlementService.canBuild(message.buildingId);
        reason = check.reason ?? null;
        if (check.ok) {
          ok = await settlementService.startConstruction(message.buildingId, {
            requestedBy: user.name,
            quiet: true
          });
          if (!ok) reason = "Не удалось начать строительство.";
        }
      }

      game.socket.emit(CHANNEL, {
        type: "construction-result",
        requestId: message.requestId,
        userId: message.userId,
        buildingId: message.buildingId,
        buildingName: building?.definition?.name ?? "Постройка",
        ok,
        reason
      });

      // Это информационное уведомление, не запрос подтверждения.
      if (ok) ui.notifications.info(`${user.name} начал строительство: ${building.definition.name}.`);
      return;
    }

    if (message.type === "construction-result" && message.userId === game.user?.id) {
      settle(message.requestId, message);
      if (message.ok) ui.notifications.info(`Строительство «${message.buildingName}» начато.`);
      else ui.notifications.warn(message.reason || "Не удалось начать строительство.");
    }
  });
}

export async function requestConstruction(buildingId) {
  if (game.user?.isGM) return settlementService.startConstruction(buildingId);

  const check = settlementService.canBuild(buildingId);
  if (!check.ok) {
    ui.notifications.warn(check.reason);
    return false;
  }

  // World settings Foundry изменяются через GM-клиент. Это не подтверждение:
  // GM ничего не нажимает, действие выполняется автоматически.
  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications.warn("Settlement Manager: сейчас нет активного ГМа, поэтому общее состояние мира нельзя изменить.");
    return false;
  }

  const id = makeRequestId("construction");
  const response = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, timedOut: true, reason: "Не удалось синхронизировать строительство с миром Foundry." });
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
  });

  game.socket.emit(CHANNEL, {
    type: "construction-execute",
    requestId: id,
    userId: game.user.id,
    buildingId
  });

  const result = await response;
  if (result?.timedOut) ui.notifications.warn(result.reason);
  return Boolean(result?.ok);
}
