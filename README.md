# Settlement Manager v1.0.0-dev.8.2.4

Модуль управления поселением для Foundry VTT 13.

## Что это

Окно поселения с вкладками: обзор, постройки (уровни и сроки по игровому времени),
просьбы жителей, проекты, летопись, панель ГМа, редактор данных и контент-паки.
Состояние живёт в world-setting и синхронизируется между клиентами.

Открыть: `Settlement.open()` в консоли или `game.modules.get("settlement-manager").api.open()`.

## Постройки, доступ и чертежи

У каждой постройки есть режим доступа, который выставляет ГМ:

- **Открыто** — игроки видят и могут строить;
- **Нужен чертёж** — видят, но начать не могут;
- **Скрыто** — не видят вовсе.

Чертежи создаются в редакторе данных и перечисляют постройки, которые открывают.
Когда поселение находит чертёж (кнопка «Выдать поселению» или `Settlement.grantBlueprint(id)`),
все перечисленные в нём постройки становятся доступными независимо от выставленного
режима — и в летописи появляется запись о находке.

## Редактор данных

Слева — список построек, ресурсов и чертежей выбранного пака, справа — форма
выбранного элемента. Кнопки «Новая постройка / Новый ресурс / Новый чертёж»
открывают пустую форму; сохранение создаёт элемент в текущем паке.

Встроенный контент модуля не редактируется напрямую — его можно клонировать
в свой пак («Дополнительные инструменты»), клон с тем же id переопределяет
встроенную версию, пока пак включён.

## Сброс и перенос

- «Управление» → «Сбросить состояние поселения» — возвращает игровые данные
  к стартовым, контент-паки не трогает.
- «Редактор данных» → «Экспорт / импорт» — выгрузка состояния и всех паков в JSON.

## API

```js
Settlement.open();
Settlement.getData();
Settlement.addResource("wood", 10);
Settlement.canBuild("blacksmith");
Settlement.startConstruction("blacksmith");
Settlement.checkConstruction();                        // досрочно проверить завершение
Settlement.setBuildingAccess("townhall", "locked");    // unlocked | locked | hidden
Settlement.getEffectiveAccess("townhall");             // доступ с учётом чертежей
Settlement.getBlueprints();
Settlement.grantBlueprint("bp-blacksmith");            // поселение нашло чертёж
Settlement.revokeBlueprint("bp-blacksmith");
Settlement.addChronicleEntry({ title: "Пришёл караван" });
Settlement.factoryReset();                             // сброс состояния, паки сохраняются
```

## Разработка

```bash
npm run check
```

Список изменений — в [CHANGELOG.md](CHANGELOG.md), устройство и инварианты —
в [ARCHITECTURE.md](ARCHITECTURE.md).


### Resource intake
GM has a separate `Добавить ресурсы` tab.

- `Управление → Ресурсы` sets exact stock values.
- `Добавить ресурсы` adds entered amounts to current stock.


### UI 2.0
- permanent left navigation;
- compact tables for scalable lists;
- master-detail layouts;
- collapsible GM management sections.

Gameplay data and existing actions were preserved.


### UI 2.1
- Overview is now a live settlement dashboard.
- Buildings use a compact explorer/table layout.
- Building categories have subtle visual accents.


### UI 2.2
Requests and projects now share one `Доска` screen:
- resident requests use warm notice cards;
- settlement projects use cool-toned project notices;
- the two categories stay visually separated.

The buildings screen was widened and compact badges prevent column clipping.
