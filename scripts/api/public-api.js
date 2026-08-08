import { resetSettlementState } from "../core/storage.js";
import { SettlementApplication } from "../ui/settlement-app.js";
import { settlementService } from "../services/settlement-service.js";
import { requestConstruction } from "../integrations/socket.js";
import { getContentSnapshot } from "../core/content-registry.js";

let app = null;

function getApp() {
  if (!app) {
    app = new SettlementApplication();
    // Окно закрыли — отпускаем ссылку, чтобы не держать отрендеренный
    // контекст и состояние редактора до конца сессии.
    Hooks.once("closeSettlementApplication", () => { app = null; });
  }
  return app;
}

export const SettlementAPI = {
  open() {
    return getApp().render({ force: true });
  },
  openPlayerView() {
    return getApp().render({ force: true });
  },
  openTab(tab) {
    const target = getApp();
    target.activeTab = tab;
    return target.render({ force: true });
  },
  openBuilding(buildingId) {
    const target = getApp();
    target.activeTab = "buildings";
    target.selectedBuildingId = buildingId;
    return target.render({ force: true });
  },
  getData: () => settlementService.getData(),
  getEffectiveData: () => settlementService.getEffectiveData(),
  getBuildingBonuses: () => settlementService.getBuildingBonuses(),
  getRestHealingBonus: () => settlementService.getRestHealingBonus(),
  calculateRestHealing: (baseAmount) => settlementService.calculateRestHealing(baseAmount),
  getContent: () => getContentSnapshot(),
  getBuildings: () => settlementService.getBuildings(),
  getBuilding: (id) => settlementService.getBuilding(id),
  getBuildingAccess: (id) => settlementService.getBuildingAccess(id),
  getEffectiveAccess: (id) => settlementService.getEffectiveAccess(id),
  setBuildingAccess: (id, access) => settlementService.setBuildingAccess(id, access),
  unlockBuilding: (id) => settlementService.setBuildingAccess(id, "unlocked"),
  lockBuilding: (id) => settlementService.setBuildingAccess(id, "locked"),
  hideBuilding: (id) => settlementService.setBuildingAccess(id, "hidden"),

  getBlueprints: () => settlementService.getBlueprints(),
  isBlueprintKnown: (id) => settlementService.isBlueprintKnown(id),
  grantBlueprint: (id) => settlementService.setBlueprintKnown(id, true),
  revokeBlueprint: (id) => settlementService.setBlueprintKnown(id, false),

  getActiveConstruction: () => settlementService.getActiveConstruction(),
  getResource: (resource) => settlementService.getResource(resource),
  hasResources: (cost) => settlementService.hasResources(cost),
  addResource: (resource, amount) => settlementService.addResource(resource, amount),
  addResources: (resources) => settlementService.addResources(resources),
  removeResource: (resource, amount) => settlementService.removeResource(resource, amount),
  canBuild: (id) => settlementService.canBuild(id),
  startConstruction: (id) => requestConstruction(id),
  upgradeBuilding: (id) => requestConstruction(id),
  checkConstruction: (options) => settlementService.checkConstruction(options),

  addRequest: (data) => settlementService.addRequest(data),
  setRequestStatus: (id, status) => settlementService.setRequestStatus(id, status),
  deleteRequest: (id) => settlementService.deleteRequest(id),
  addProject: (data) => settlementService.addProject(data),
  startProject: (id) => settlementService.startProject(id),
  completeProject: (id) => settlementService.completeProject(id),
  failProject: (id) => settlementService.failProject(id),
  deleteProject: (id) => settlementService.deleteProject(id),
  addChronicleEntry: (data) => settlementService.addChronicleEntry(data),
  reset: () => settlementService.reset(),

  /**
   * DEV/GM: reset gameplay state without deleting content packs.
   */
  async factoryReset() {
    if (!game.user?.isGM) throw new Error("Только ГМ может сбросить поселение.");
    return resetSettlementState();
  }
};

export function refreshSettlementApp() {
  if (app?.rendered) app.render();
}
