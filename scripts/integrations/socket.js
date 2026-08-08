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
      return;
    }

    if (message.type === "player-action-execute") {
      const gm = primaryActiveGM();
      if (!game.user?.isGM || !gm || gm.id !== game.user.id) return;

      const user = game.users.get(message.userId);
      let ok = false;
      let reason = "Некорректный запрос игрока.";
      let label = "Действие";

      if (user && message.action === "accept-request") {
        const request = settlementService.getData().requests?.find((entry) => entry.id === message.entityId);
        label = request?.title ?? "Просьба";
        if (!request) reason = "Просьба не найдена.";
        else if (request.status !== "available") reason = "Эта просьба уже принята или завершена.";
        else {
          ok = await settlementService.acceptRequest(message.entityId, { acceptedBy: user.name });
          if (!ok) reason = "Не удалось принять просьбу.";
        }
      } else if (user && message.action === "start-project") {
        const project = settlementService.getData().projects?.find((entry) => entry.id === message.entityId);
        label = project?.title ?? "Проект";
        const check = settlementService.canStartProject(message.entityId);
        reason = check.reason ?? null;
        if (check.ok) {
          ok = await settlementService.startProject(message.entityId, { requestedBy: user.name });
          if (!ok) reason = "Не удалось взять проект.";
        }
      }

      game.socket.emit(CHANNEL, {
        type: "player-action-result",
        requestId: message.requestId,
        userId: message.userId,
        action: message.action,
        label,
        ok,
        reason
      });

      if (ok) ui.notifications.info(`${user.name}: ${label}.`);
      return;
    }

    if (message.type === "player-action-result" && message.userId === game.user?.id) {
      settle(message.requestId, message);
      if (message.ok) {
        const verb = message.action === "accept-request" ? "Просьба принята" : "Проект взят";
        ui.notifications.info(`${verb}: ${message.label}.`);
      } else {
        ui.notifications.warn(message.reason || "Не удалось выполнить действие.");
      }
    }
  });
}

export async function requestPlayerAction(action, entityId) {
  if (game.user?.isGM) {
    if (action === "accept-request") return settlementService.acceptRequest(entityId, { acceptedBy: game.user.name });
    if (action === "start-project") return settlementService.startProject(entityId, { requestedBy: game.user.name });
    return false;
  }

  const state = settlementService.getData();
  if (action === "accept-request") {
    const request = state.requests?.find((entry) => entry.id === entityId);
    if (!request || request.status !== "available") {
      ui.notifications.warn(request ? "Эта просьба уже принята или завершена." : "Просьба не найдена.");
      return false;
    }
  } else if (action === "start-project") {
    const check = settlementService.canStartProject(entityId, state);
    if (!check.ok) {
      ui.notifications.warn(check.reason);
      return false;
    }
  } else {
    return false;
  }

  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications.warn("Settlement Manager: сейчас нет активного ГМа, поэтому общее состояние мира нельзя изменить.");
    return false;
  }

  const id = makeRequestId("player-action");
  const response = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, timedOut: true, reason: "Не удалось синхронизировать действие с миром Foundry." });
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
  });

  game.socket.emit(CHANNEL, {
    type: "player-action-execute",
    requestId: id,
    userId: game.user.id,
    action,
    entityId
  });

  const result = await response;
  if (result?.timedOut) ui.notifications.warn(result.reason);
  return Boolean(result?.ok);
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
