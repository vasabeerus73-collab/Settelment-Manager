# Changelog

## 1.0.0-dev.8.2 — Board & Layout pass
- Merged resident requests and settlement projects into one «Доска» tab.
- Added visually distinct notice-board sections for resident requests and projects.
- Converted requests/projects from sparse tables into responsive notice cards.
- Rebalanced the buildings workspace to prevent clipped access/status columns.
- Made building access/status badges compact and tooltip-friendly.
- Kept old `requests`/`projects` tab links compatible by redirecting them to `board`.

## 1.0.0-dev.8.1
- Fixed extra closing div in Buildings UI which broke ApplicationV2 single-root rendering.
- Added HTML nesting sanity check to the project checker.

## 1.0.0-dev.8 — Dashboard & Building Explorer
- Rebuilt settlement Overview into a true dashboard.
- Added active construction, active requests, recent chronicle and settlement counters to the dashboard.
- Converted building list to compact explorer/table layout.
- Added subtle category accent strips for buildings.
- Preserved all existing gameplay actions and data.

## 1.0.0-dev.7 — UI 2.0
- Replaced horizontal navigation with a permanent left sidebar.
- Converted requests, projects, chronicle, resource intake and packs to compact table layouts.
- Reworked GM Management into collapsible compact sections.
- Standardized master-detail layouts for buildings, packs and Data Editor.
- Preserved existing gameplay actions and data model.

## 1.0.0-dev.6
- Moved additive resource intake out of GM Management.
- Added separate GM-only «Добавить ресурсы» tab.
- Exact resource editing in Management remains unchanged.
- Added compact intake cards with current stock and additive inputs.

## 1.0.0-dev.5
- Added a separate GM "Добавить добычу" panel.
- Existing resource inputs still set exact stock values.
- Quick-add inputs add deltas to current stock in one atomic state write.
- Added public API `Settlement.addResources({ wood: 15, metal: 4 })`.


## 1.0.0-dev.4

Перенос исправлений ветки 0.6.3 на структуру dev.3. Раскладка папок, миграции
и factory reset из dev.3 сохранены.

### Data Editor — исправлены регрессии dev.3
- `editorMode` теперь инициализируется (`"building"`). Раньше поле не объявлялось,
  все три `is*Mode` были false, и правая панель редактора открывалась пустой.
- Первую постройку в паке снова можно создать. «Быстро создать постройку» читала
  `editor.name` — поле, которое рендерится только в building-режиме, а тот включался
  только кликом по уже существующей постройке. Кнопка заменена на «Новая постройка»,
  симметричную «Новому ресурсу» и «Новому чертежу»: она открывает пустую форму
  с черновым уровнем 1.
- «Новый ресурс» и «Новый чертёж» больше не подставляют первый существующий элемент.
  Введено различие «ещё не выбирали» (`undefined`) и «создаём новый» (`null`).
- Смена пака в выпадающем списке перерисовывает форму. Раньше на экране был один пак,
  а сохранение уходило в другой.
- Экспорт/импорт вынесен из-под `{{#if hasCustomPacks}}` — на чистом мире выгрузку
  сделать было нельзя.

### Игровая логика
- Эффекты уровней: разделителем был литерал `"\\n"` вместо перевода строки —
  список схлопывался в одну строку с видимым `\n`.
- Ресурсы из контент-паков попадают в состояние мира. Раньше `state.resources[x]`
  оставался `undefined`, `x - cost` давал `NaN`, и запас сохранялся в мир как `null`.
  `Settlement.addResource()` на такой ресурс отвечал «неизвестный ресурс».
- Чертежи заработали. Режим доступа «Нужен чертёж» (и «Скрыто») снимается, когда
  поселение находит открывающий чертёж: кнопка «Выдать поселению», список найденных
  в боковой панели, запись в летописи, API `grantBlueprint` / `revokeBlueprint`.
- `checkConstruction()` защищён от параллельного запуска: `updateWorldTime` больше
  не может засчитать одно завершение дважды.
- Все числовые поля проходят через общую нормализацию `toCount()`: мусор, `NaN`
  и отрицательные значения дают 0, ресурсы не уходят в минус.
- Enter в текстовом поле больше не «сохраняет параметры поселения» с чужой вкладки.
- Импорт проверяет структуру bundle и спрашивает подтверждение перед заменой мира.
- Ошибки валидации контент-паков показываются ГМу, а не только в консоли.
- Ошибка загрузки data-пакета больше не роняет модуль: раньше `throw` на верхнем
  уровне ESM отменял хук `init`, и настройки не регистрировались вовсе.

### Память и производительность
- Таймаут сокет-запроса снимается при получении ответа (жил 8 секунд вместе с замыканием);
  повторная регистрация сокета не вешает второй обработчик.
- Летопись ограничена 500 записями — world-setting больше не растёт бесконечно.
- Рендер перестал перечитывать world-setting дважды на каждую постройку и делать
  четыре глубоких копии всего контента.
- Ссылка на окно освобождается при закрытии.
- Убран мёртвый код (`coreBuildingIds`, `sourcePack`, неиспользуемые импорты).

### Прочее
- Схема данных 2: массив найденных чертежей + обрезка летописи. Миграция выполняется
  после `applyCustomPacks()`, чтобы ресурсы паков попали в состояние.
- Регистрируются недостающие Handlebars-хелперы (`eq`, `and`, …) — шаблон опирается
  на них, а в документации Foundry 13 они не описаны.
- `compatibility.maximum` снят: жёсткий потолок «13» блокировал бы модуль на v14,
  даже если он там работает. `verified` возвращён к `13.351`.
- `npm run check` теперь проверяет весь `data/`, включая `buildings/*.json`,
  баланс блоков шаблона, связь `data-action` с обработчиками и совпадение версий.

## 1.0.0-dev.3
- Moved custom resources into the common Data Editor sidebar.
- Data Editor now uses one navigation model for buildings, resources and blueprints.
- Selecting an element switches the right panel to the matching editor.
- Moved cloning/import-export tools into a collapsible advanced section.

## 1.0.0-dev.2
- Added GM-only factory reset for settlement gameplay state.
- Reset preserves custom content packs and Data Editor content.
- Added `Settlement.factoryReset()` developer API.
- Added explicit destructive-action confirmation.

## 1.0.0-dev
- Reorganized runtime into core/services/ui/integrations/api/utils.
- Preserved the 0.6.x UI and settlement gameplay model.
- Removed dependency on `foundry.utils.slugify`.
- Added internal ID generator.
- Added world-data schema migration.
- Kept existing module ID and legacy setting keys.
- Added development validation script and architecture notes.
