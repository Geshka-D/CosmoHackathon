# Расчётный контракт M1 + workspace M2 — schema 1.0, adapter 1.0.0

Локальный FastAPI backend сохраняет четыре расчётных endpoint M1 и добавляет два workspace endpoint M2, описанные ниже. Все данные кейса — локальные S1–S6 v1.1; сетевые сервисы для расчёта не используются. Запуск UI/API описан в [README_RUN.md](../README_RUN.md). Swagger/Redoc не включены; контракт приведён здесь и в строгих Python-моделях.

## Запрос расчёта

`POST /api/evaluate`, заголовок `Content-Type: application/json`. Все поля обязательны:

```json
{
  "schema_version": "1.0",
  "case_id": "SEP-KOSMOS-INFRA-2026",
  "case_version": "1.1",
  "selection": [
    {"lot_id": "FIRE", "mode_id": "A"},
    {"lot_id": "FLOOD", "mode_id": "A"},
    {"lot_id": "INFRA", "mode_id": "B"},
    {"lot_id": "ENV", "mode_id": "A"}
  ]
}
```

Это регрессионный пример, не итоговый выбор. Любые 0–4 уникальных ID из каталога разрешены для расчёта; режимы только A/B/C. Пустой/частичный состав получает `completeness.status=INCOMPLETE`, `scenarios.BASE/STRESS.status=INCOMPLETE`, `ok=null`. Девять диагностик каждого сценария — `NOT_EVALUATED`. Для непустого частичного состава возвращаются промежуточные метрики; у пустого численная экономика/индексы `null`, selected_lots=0.

Четыре уникальные строки возвращают `COMPLETE` и отдельный `PASS`/`FAIL` для каждого сценария. Полный, но недопустимый портфель — HTTP 200 с рассчитанными фактами. HTTP-ошибки не означают финансовую недопустимость.

Отклоняются: >4 строки (включая 5 строк/4 unique), повторы lot_id при любом режиме, неизвестные ID/D, неверные типы и версии, отсутствующие/лишние поля на любом уровне, недопустимый JSON, повторные JSON-ключи, NaN/Infinity/overflow 1e999, некорректный UTF-8 и одиночные Unicode surrogates. Boolean не преобразуется в ID; `public_core`, коэффициенты, scenario overrides, метрики и готовые результаты вообще не входят в запрос. Строки `"false"` не превращаются в boolean. При импорте сохранённого ResultBundle следует взять `original_request` или `applied_request` и заново отправить его; сам bundle как вход отвергается.

Предел 65 536 байт применяется к API и CLI, включая chunked HTTP без Content-Length. Сжатые тела запроса не поддерживаются. Это инженерный предел приложения, не правило организаторов.

## ResultBundle

| Поле | Значение |
|---|---|
| `schema_version`, `adapter_version`, `case_id`, `case_version` | Версии контракта, адаптера и сохранённого кейса |
| `original_request` | Проверенный исходный запрос, с исходным порядком строк |
| `applied_request`, `selection` | Тот же состав, отсортированный по lot_id/mode_id для стабильного порядка арифметики |
| `input_fingerprint` | SHA-256 канонического JSON `{schema_version,adapter_version,source_hashes,applied_request}` |
| `source_hashes`, `sources` | Фактические SHA-256 восьми S1–S6 и принятого manifest; source_id/пути/размеры/версии |
| `completeness` | COMPLETE/INCOMPLETE, выбранное и требуемое число лотов |
| `detail` | Полный вклад каждой пары лот/режим; CASH раскрыт как anchor+commercial; происхождение полей |
| `metrics` | Канонические суммы/средние/отношение сумм и отдельно суммы двух денежных компонентов |
| `scenarios.BASE`, `scenarios.STRESS` | Статус и ровно девять diagnostics; общие metrics/detail не дублируются |
| `units`, `period`, `assumption_refs` | Единицы, старт + год эксплуатации, ссылки на неизменённые assumptions |
| `provenance.aggregates` | Формулы, значения, вклад выбранных строк и ссылка на функцию источника |

Детали provenance указывают source file, row_key, field/value, coefficient/value, формулу и единицы. У индексов нет модификатора режима. CASH из core не заменяется суммой агрегированных компонентов: последняя может отличаться последним битом float из-за порядка операций. Никакого округления до проверок. VPUB — синтетическая общественная ценность, отдельно от CASH; KCASH — CASH/OPEX; t_rep — заданный безразмерный индекс без придуманной расшифровки.

Сценарии используют одни metrics/detail. STRESS изменяет только C0_max: 1300→1180; у приведённого примера C0=1297, запас BASE=3, STRESS=-117. Диагностика имеет `id`, условие, metric, comparator, limit, fact, unit, status/ok, evaluated, margin, deficit, violation_direction, eps, tolerance_accepted, action, limit_source и formula_source.

Положительный `margin` означает запас; для `<=` это limit-fact, для `>=` fact-limit, для `==` -abs(fact-limit). `deficit=max(-margin,0)` не округляется; `violation_direction` описывает фактическое отклонение. Итог `ok` полного набора берётся из core. Для непрерывных порогов eps=1e-9, для целых счётчиков 0. Небольшой отрицательный margin может быть принят по eps; тогда `tolerance_accepted=true`. Неполный набор имеет `ok=null` даже при промежуточном запасе. Действия — варианты исправления с повторной проверкой, без обещания допустимости и автоматической замены состава.

Формат сериализации API/CLI: UTF-8 без BOM, ключи отсортированы, компактные separators, один LF в конце, запрещены non-finite числа. Нет времени генерации/случайного ID. Один и тот же запрос/источники/версия дают одинаковые bytes. Перестановка строк сохраняет calculation fingerprint/metrics/detail, но изменяет original_request и поэтому полные bytes. Fingerprint не подпись и не основание доверять полученным от клиента результатам. Настройки рейтинга/нормализации/финального выбора в M1 отсутствуют.

## Сравнение

`POST /api/compare` принимает:

```json
{
  "schema_version": "1.0",
  "alternatives": [
    {"alternative_id": "option-1", "request": {"schema_version":"1.0","case_id":"SEP-KOSMOS-INFRA-2026","case_version":"1.1","selection":[{"lot_id":"FIRE","mode_id":"A"},{"lot_id":"AGRI","mode_id":"A"},{"lot_id":"TRANS","mode_id":"B"},{"lot_id":"ENV","mode_id":"C"}]}},
    {"alternative_id": "option-2", "request": {"schema_version":"1.0","case_id":"SEP-KOSMOS-INFRA-2026","case_version":"1.1","selection":[{"lot_id":"FIRE","mode_id":"A"},{"lot_id":"AGRI","mode_id":"A"},{"lot_id":"TRANS","mode_id":"B"},{"lot_id":"ENV","mode_id":"A"}]}}
  ]
}
```

Инженерные пределы: 2–10 полностью определённых альтернатив, у каждой четыре уникальных лота. `alternative_id` уникален, 1–64 символа `[A-Za-z0-9_-]`; порядок сохраняется. Одинаковые составы разрешены для явного сопоставления, ID различны. Каждая альтернатива пересчитывается на одном проверенном снимке источников. Полный FAIL разрешён. Результат: `alternatives[].result` (ResultBundle), `metric_table`, `scenario_table`, `original_request`, source hashes и SHA-256 канонического списка `{alternative_id,input_fingerprint}` как `comparison_fingerprint`. Ранжирование не выполняется.

## Каталог, готовность и ошибки

`GET /api/case` возвращает 8 lots, 3 modes с настоящими boolean, ограничения/сценарии, единицы/период, provenance каталога, ограничения ввода и хеши. Значения CSV/config доступны только для чтения.

`GET /api/health` заново проверяет все восемь источников и закреплённый manifest: 200 `ready=true`, либо 503 `ready=false`. Проверка работает после старта процесса и при исходно отсутствующих файлах. Evaluate/compare/case при недоступном источнике также возвращают 503. Загрузка не зависит от cwd, ZIP, root CONTROL или исторического inventory. SHA-256 manifest в `case_loader.py` — release trust anchor принятого M0; смена версии источника требует отдельного решения и обновления anchor.

Ошибки имеют `{ "error": { "code": "...", "message": "...", "issues": [{"location": [...], "type": "...", "message": "..."}] } }`. Ошибка вложенного варианта указывает `alternatives`, индекс и поле. Не возвращаются traceback, исходные тела или абсолютные пути файлов сервера.

| HTTP | Причина |
|---|---|
| 400 | Неверный/неоднозначный JSON, некорректный Content-Length |
| 413 | Тело больше 65 536 байт |
| 415 | Не application/json или сжатое тело |
| 422 | Ошибка строгой схемы/ID/уникальности/комплектности сравнения |
| 503 | Источник отсутствует или не прошёл проверку |
| 500 | Контролируемая внутренняя ошибка; подробности только в локальном журнале |

## CLI

`python -X utf8 -B /absolute/path/scripts/reproduce.py request.json [--compare] [--output NEW.json]`.

Относительный input/output относится к cwd вызывающего, источники — к расположению приложения. Вместо input можно передать `-` для UTF-8 stdin. Без `--output` JSON идёт в stdout; ошибки в stderr. `--output` создаёт только новый файл (`xb`), не перезаписывает существующие данные. Родительская директория должна существовать. CLI exit 0 означает завершённый расчёт, включая FAIL и INCOMPLETE; exit 2 — неверный ввод, exit 3 — источник/файл/внутренняя ошибка.

## Прочитанная первичная документация библиотек

Для M1 через Context7 прочитаны [FastAPI Request](https://fastapi.tiangolo.com/reference/request), [FastAPI Handling Errors](https://fastapi.tiangolo.com/tutorial/handling-errors), [Pydantic strict mode](https://github.com/pydantic/pydantic/blob/main/docs/concepts/strict_mode.md), [Pydantic configuration](https://github.com/pydantic/pydantic/blob/main/docs/concepts/config.md). Применён общий StrictModel с strict/extra-forbid для вложенных моделей; JSON декодируется самостоятельно до валидации для запрета duplicate keys/non-finite. Реальные совместимые версии проверены в `.venv`, не взяты из предположений.

## M2: версионированная конфигурация браузера

`POST /api/workspace/recompute` и `POST /api/export` принимают **одинаковый configuration-only конверт**, максимум **65 536 bytes**:

- `format_version`: строго `kosmos-workspace/1`.
- `source_hashes`: точный словарь хешей из GET /api/case, включая release manifest. Несовпадение даёт 422 `incompatible_sources`.
- `workspace.current`: `{name, request}`; request — прежний строгий EvaluateRequest с 0–4 лотами. name — 1–80 символов, не пустые пробелы/управляющие символы.
- `workspace.alternatives`: 0–3 снимка `{alternative_id, name, request}`. В каждом четыре уникальных лота; разные ID, имена (сравнение strip/casefold) и составы/режимы. ID — 1–64 символа `[A-Za-z0-9_-]`. В UI UUID используется только для идентичности ручного варианта, не в математике. Один сохранённый вариант — подготовка к сравнению, 2–3 — сравнение.
- `workspace.scenario`: BASE или STRESS; это выбор отображения официальных диагностик, не override порогов.

Имена, IDs и сценарий отображения находятся **вне EvaluateRequest**. Старый /api/compare по-прежнему принимает 2–10 полных вариантов, включая FAIL; его вход/выход и расчётные байты не менялись. Лимит 3 workspace-альтернатив — ограничение интерфейса, не исходного ядра или организаторов.

`/api/workspace/recompute` строго валидирует весь конверт, проверяет источник, затем на одном проверенном снимке пересчитывает current и alternatives через evaluate_validated. Возвращает исходную конфигурацию плюс `computed.current`, `computed.alternatives[].result` — обычные M1 ResultBundle, с original/applied request, fingerprint, source hashes, метриками, девятью diagnostic и provenance. `computed.deltas` — разницы числовых метрик относительно первой альтернативы; их вычисляет Python. Они не являются MCDA-score, рейтингом или рекомендацией.

`/api/export` тоже проверяет/пересчитывает вход, но возвращает **только** `{format_version, source_hashes, workspace}` с `Content-Disposition: attachment; filename="kosmos-workspace.json"`. Нет результатов, PASS, computed, CONTROL answers или огромного CompareResult в импортируемом файле. Поэтому ответ recompute не является допустимым запросом import/export: лишнее поле computed будет отклонено. Отдельный экспорт результатов/CSV относится к последующему комплекту M5.

Импорт файла передаёт Blob исходных байтов с Content-Type application/json **до** JSON.parse/File.text в браузере. Строгий decoder M1 обнаруживает duplicate keys, неверный UTF-8, surrogate, non-finite и превышение размера. Неизвестные/лишние поля, версии, IDs, режимы и неполные альтернативы отвергаются. Никакой «готовый PASS» от клиента не используется. Ошибка не изменяет текущие настройки; показанные результаты скрываются до успешного пересчёта.

LocalStorage хранит только этот configuration-only конверт под ключом `kosmos.workspace.v1`; при reload raw строка также сначала отправляется серверу. Повреждённая запись сохраняется до намеренного ручного изменения, UI предлагает выгрузить резервную копию. Запись в localStorage выполняется после успешного расчёта; отказ хранилища явно сообщается и не препятствует JSON export. History/undo — до 20 операций в памяти, после reload не восстанавливается.

Все асинхронные пути используют ревизию входа; effect cleanup отменяет запросы, а результат дополнительно связывается с сериализованным входом. Edit/reset/load/import/restore/comparison не могут подставить ответ прежнего запроса в новый состав. Во время ожидания результаты скрыты. BASE/STRESS имеют один состав/стоимость и разные официальные бюджетные проверки.

Production-статика монтируется после /api routes и только из frontend/dist, если сборка существует при запуске Python. Корень проекта/источники/отчёты не публикуются. Vite development proxy обращается только к локальному Python 8000. В браузере нет второго расчётного ядра или внешних сервисов.

## Дополнение «Волна 1»: параметры команды и аналитические endpoint

`GET /api/case` дополнительно возвращает `team_defaults`, `team_presets` и `team_setting_provenance`. Workspace принимает `team_settings`: `optimism_uplift` 0–2, `sigma` 0–1, `rho` 0–1, `confidence` строго между 0,5 и 1, `alpha` 0–1, `phi` 0–1 и непустой `stress_plan`. Все модели strict/extra-forbid; результат показывает применённые значения.

- `POST /api/option/exercise` принимает `kosmos-option/1`, source hashes, обычный EvaluateRequest, stress plan и необязательные team settings. Действия обязаны ссылаться на выбранный лот и фактический `from`; `after` — обычный ResultBundle, повторно рассчитанный каноническим адаптером.
- `POST /api/coalition` принимает `kosmos-coalition/1`, source hashes, полный EvaluateRequest и необязательный `phi`. Возвращает характеристическую функцию, доли Шепли, 14 проверок ядра, простые правила и чувствительность.
- `GET /api/shadow-prices?scenario=BASE|STRESS` возвращает девять конечных экспериментов над сохранённой популяцией.
- `GET /api/frontier` принимает необязательные числовые параметры команды и возвращает лестницу надбавки, обе кривые, региональные частоты, классификацию стресс-ответа и надёжную популяцию.

ResultBundle дополнен `team_analysis`: применённые настройки/происхождение, H, effective lots, стандартное отклонение, вероятность, резерв и статус надёжности по двум сценариям; для полного портфеля также торнадо, тип стресс-ответа и ближайший ремонт. Канонические `metrics`, `detail`, `provenance` и исходные `c0_mrub` не изменяются.

M2: через Context7 прочитаны первичные [React useEffect cleanup](https://github.com/reactjs/react.dev/blob/main/src/content/learn/synchronizing-with-effects.md), [Vite React/TypeScript template](https://github.com/vitejs/vite/blob/main/packages/create-vite/template-react-ts/vite.config.ts), [Playwright library lifecycle](https://github.com/microsoft/playwright/blob/main/docs/src/library-js.md). Фактические версии закреплены package.json/package-lock.json; инструкции навыков frontend-design/Context7 применены в пределах локального пользовательского плана.
# M3: отдельный decision-контракт поверх сохранённых M1/M2

Новые endpoints: GET `/api/decision-method`; POST `/api/search`, `/api/sensitivity`, `/api/decision/recompute`, `/api/decision/export`. Старые endpoints и `kosmos-workspace/1` не расширяются новыми доверенными computed-полями. Сохраняются raw UTF-8 JSON decoder, 65536-byte input cap, finite validation, строгие unknown-field/duplicate-key ошибки и верификация исходников.

`SearchRequest`: `format_version="kosmos-search/1"`, `case_id`, `case_version`, `source_hashes`, `modes="A/B/C"`, `method_version="weighted-mcda/base-reference/1"`, `scenario=BASE|STRESS`, восемь обязательных `weights`, `limit` (1–100, default 10), `baseline` (null либо полный EvaluateRequest). Baseline относится только к sensitivity; search не меняет ранги из-за выбранного исходного портфеля. Все веса конечны, >=0, хотя бы один >0. Нормирование сначала делит на максимум, избегая переполнения суммы; исходный вектор сохраняется.

Search возвращает request/fingerprint, original/applied weights, счётчики всего пространства и пересекающихся исключений обоих сценариев, reference definition/size/bounds/id, ranking с unrounded score/contributions/normalized/raw metrics, 9 boolean checks обоих сценариев и бюджетными margins. Полная популяция доступна Python: `enumerate_population(snapshot, engine="fast"|"original")`; она не требует контрольных ответов или evidence.

Sensitivity принимает тот же SearchRequest. Возвращает `baseline_kind`, явно идентифицированный `original_choice`, четыре `runs` с criterion/multiplier/weights/fingerprint/leader/score, `original_choice_rank` и score (null для недопустимого), состав/режимы изменений. При null baseline используется лидер текущего сценария/профиля, что явно обозначено. Равновесный профиль рассчитывается отдельно на той же R. Perturbed proportional weights исходят из нормированного исходного вектора; это та же относительная операция с безопасным finite диапазоном.

`DecisionEnvelope`: `format_version="kosmos-decision/1"`, `request: SearchRequest`, `expected_population_id: null|sha256`. Recompute заново проверяет источники и популяцию, затем считает search/sensitivity, BASE и STRESS рекомендации, предметные BASE альтернативы и их raw deltas/inputs/user tasks. Клиентские results/bounds/score/PASS и другие поля отвергаются. Несовпадение ожидаемой популяции — ошибка, не доверие к imported metadata. Экспорт возвращает только этот configuration envelope, полные results сохраняются отдельно. Текущий переносимый пример — `config/m3_decision.json`; результат — `results/m3_decision.json`.

Population cache ограничен двумя source/config/mode/calculator identities; search cache — 16 полными fingerprints с operation/method/normalization/weights/scenario/baseline/limit. Исходные raw metadata не смешиваются у пропорциональных весов. Кэши возвращают независимые копии и не обходят `CaseRepository.load`. Sensitivity заново ранжирует каждый опыт; его fingerprint содержит operation/criterion/factor/baseline и search identity. Ни постоянного дискового кэша, ни Redis/БД нет.

# M4: сохранённая управленческая конфигурация

`GET /api/implementation` заново рассчитывает `config/m3_decision.json`, валидирует четыре lot/mode-карточки `management.json`, полноту ролей/KPI/рисков/источников, доли полного C0, A/B/C/public_core и предложенный календарь из assumptions. Возвращает `kosmos-management/1`: release_id/identity, finance, services с c0_funding/flows/basis, alternatives, stress, sensitivity, source ResultBundle, configuration/assumptions и materials (три Markdown-текста того же результата). Нельзя передать произвольный портфель и получить пояснения сохранённой рекомендации.

`GET /api/implementation/finance.csv` выдаёт свежие финансовые таблицы всех стратегий с release_id в каждой строке. Индивидуальные и портфельные gaps различены; дополнительная поддержка не меняет canonical CASH/KCASH/OPEX. Ошибки management/assumptions — `management_unavailable` 503; source-integrity ошибки остаются `source_unavailable` 503. Старые сохранённые JSON/Markdown не используются для ответа.

Ограничение HTTP-ввода прежнее: 65536 байт. Только локальные authored management-конфигурации читаются с отдельным пределом 262144, тем же строгим JSON-decoder (duplicate keys/nonfinite запрещены). Подробная воспроизводимость: [implementation.md](implementation.md).

### M4_FIX1: согласованный выпуск

`GET /api/implementation` дополнительно содержит `finance_csv`: готовый UTF-8 CSV, вычисленный Python из того же bundle/release_id, что JSON и materials. UI сохраняет именно это поле без второго HTTP-запроса. Прямой GET finance.csv остаётся отдельным актуальным пересчётом для API-клиента. При локальной смене A→B экран и все его скачивания остаются A до успешного обновления. Во время запроса/ошибки скачивания скрыты; поздний отменённый ответ не восстанавливает старый экран.

Все assumptions проходят явную строгую закрытую схему до рендера; отсутствующие topic/status/value/id, null/type/blank в обязательном тексте, неверные optional-типы и неизвестные поля дают 503 `management_unavailable` на обоих endpoints. Null в value разрешён для явно неизвестных условий. Источники сохраняют 503 `source_unavailable`, программные ошибки не превращаются blanket-перехватом в конфигурационные. Контракт локального пятифайлового writer/reader и единой точки активации: [implementation.md](implementation.md).
