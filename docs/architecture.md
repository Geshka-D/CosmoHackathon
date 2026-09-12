# Архитектура — реализация M1 и исторический контракт M0

## Реализовано в M1

`verified source snapshot → strict schemas/JSON → canonical adapter → diagnostics/result → API/CLI`.

Расчётный сервис не зависит от HTTP. `case_loader.py` каждый раз проверяет восемь локальных S1–S6 и закреплённый SHA-256 принятого manifest. Для расчёта используются проверенные bytes CSV/config/core из одного снимка; сравнение разделяет этот снимок. Изменение источников после старта блокирует следующий расчёт. Ошибка источников не обрывает импорт приложения: health остаётся доступен с 503. Core компилируется из проверенных bytes без `.pyc` в `case_source`. Production не читает CONTROL, архив или test evidence.

`schemas.py` и `contracts.py` проверяют строгие версии/типы/поля, уникальность, лимиты и конечный однозначный JSON. `canonical_adapter.py` считает один раз и возвращает provenance, исходный и применённый запросы, fingerprint. `constraints.py` декорирует девять решений core. `comparison.py` пересчитывает 2–10 полных вариантов; `main.py` предоставляет четыре endpoint. `scripts/reproduce.py` использует этот же сервис из любой cwd.

Точный контракт — [api.md](api.md), запуск — [README_RUN.md](../README_RUN.md), зависимости — `requirements.txt` (закреплённые версии). Ручной UI принят в M2, search/MCDA/sensitivity реализованы в M3 (дополнения ниже). Финансы и сборка документов остаются следующими этапами. Coder smoke не заменяет независимую приёмку.

## Исторический контракт M0 (состояние до M1)

В M0 созданы только каталоги/инструкции, источники и документы; перечисленные ниже модули, API и UI пока не реализованы. Независимое основание — `reports/M0_ARCHITECT.md`. Существующего приложения при инвентаризации не было.

| Область | Ответственность и следующая стадия |
|---|---|
| `case_source/` | Восемь неизменных копий S1–S6; хеши проверяются, не правятся |
| `config/` | source_manifest, собственные assumptions, заранее объявленный decision, управление. В M0 selection/ranking null |
| `backend/app/` | M1: строгий loader/schemas, canonical_adapter, constraints, evaluate/compare, CLI. M3: search/decision_model/sensitivity. M5: exports/build |
| `frontend/src/{pages,components,api,state}/` | M2: React/TypeScript/Vite по плану; состояние ввода/загрузки/ошибки, каталог/конструктор/сравнение. M6: доводка |
| `results/` | Будущие пересчитанные ResultBundle и конфигурации; никаких контрольных чисел в качестве production-входа |
| `scripts/` | Сейчас только импорт источников и audit M0. В M1 CLI reproduce, в M5 build_submission; не подменять отсутствующий verify_case.py |
| `tests/` | Tester создаёт независимые тесты в своё окно записи; Coder не принимает свою работу |
| `docs/` | Содержательные Markdown-заготовки M0; финальные PDF/презентация M5 |
| `reports/` | Evidence/координация; финальное состояние и приёмка — Main/Evaluator |

Один Python-расчётный слой, один backend runtime с frontend-статикой, без БД, микросервисов, авторизации, LLM и внешних API на обязательном пути. Предлагаемые FastAPI/React/Vite будут установлены и проверены позднее; в M0 не заявлены совместимые версии или работающий сервер. `CONTROL_RESULTS.json` читается только проверками. Функциональные источники — S4/S5, не контрольные ответы и не cached notebook outputs.

Контракт будущих endpoint: `GET /api/case`, `POST /api/evaluate`, `POST /api/compare` (M1–M2), search/sensitivity (M3), export (M5), health. Imported вход строго проверяется и пересчитывается; сохранённый клиентом PASS недоверен. Факты нарушения — нормальный расчёт, неверный формат — валидационная ошибка. Новое состояние не перезаписывается поздним ответом прежнего запроса.

ResultBundle описан в methodology; UI форматирует, не повторяет экономические формулы. Финальные docs собираются из одного release input; текст выбранной рекомендации связан с fingerprint. Новые пользовательские сценарии не изменяют исходные CSV и не выдаются за официальные BASE/STRESS.

REQUIRED NOW Architect реализованы как источник/методология/приоритеты/сервисная и финансовая карта, неизвестные и будущие доказательства. NEXT STEPS M1–M7 остаются отдельными стадиями. OPTIONAL (D, Парето, сетка sensitivity, многолетняя модель, реальные интеграции) не реализованы.

## Реализация M2

Добавлен React/TypeScript/Vite ручной browser workflow с конфигурационным workspace-контрактом. Строгая модель backend/app/workspace.py хранит названия/ID/сценарий отдельно от M1 EvaluateRequest, заново вычисляет current и 0–3 альтернативы на одном проверенном снимке. Только Python считает метрики, диагностические решения и разницы сравнения; frontend форматирует их. M1 /evaluate, /compare, CLI, исходное ядро и источник сохранены.

Browser state содержит независимые снимки альтернатив, AbortController и счётчик ревизий; текущий результат показывается только при совпадении его сериализованного входа. Configuration-only export/import/localStorage не принимают cached results. Raw импорт валидируется сервером до изменения UI. FastAPI отдаёт только собранный frontend/dist и /api, без публикации дерева проекта. Подробности — docs/api.md и README_RUN.md.
# Дополнение M3 к принятой архитектуре M2

`search.py` формирует все сочетания из проверенных lots/modes. Быстрый путь предвычисляет original `apply_mode` для 24 пар, суммирует NumPy в том же отсортированном порядке и вызывает original `check_constraints`; прямой `engine="original"` доступен без cache для независимой сверки всех вариантов. Исходное ядро и M1 adapter не изменены.

`decision_model.py` задаёт восемь направлений, finite-валидацию/безопасное нормирование, постоянную BASE-шкалу, score и ties. `sensitivity.py` делает четыре rerank и равновесный профиль; явный baseline не заменяется лидером, недопустимый не ранжируется. `decision.py` объединяет результаты и конфигурацию, реальные BASE-стратегии и условный stress-action; `decision_context.py` связывает сохранённые предложения M0 с исходными лотами/режимами.

`DecisionPanel.tsx` — отдельный раздел и configuration-only storage/import. Python считает все метрики, нормированные веса, score и deltas; React показывает форматированные значения. Revision, cleanup, abort и serialized-input key закрывают устаревшие ответы при weight/scenario/baseline/import; снимок ручного baseline меняется только явным действием. API/CLI используют одни функции. M2 Workspace, compare/evaluate, ручные ограничения и три альтернативы сохранены.

Активные входы/результаты: `config/m3_decision.json` → `scripts/reproduce.py --decision` → `results/m3_decision.json`. Ни ZIP, ни CONTROL, ни historical evidence не нужны runtime. Сборка frontend остаётся статикой одного Python-сервера. Ни внешних сервисов, ни дополнительной инфраструктуры не введено.

## Дополнение «Волна 1»

`assumptions.json A16-A26 → TeamSettings → canonical_adapter → constraints/reliability → portfolio_analysis` сохраняет канонические значения и добавляет только явно маркированные показатели команды. `search.get_population()` остаётся единственным полным пространством для `stress_response`, `repair` и `advanced_analysis`; результаты кэшируются по identity популяции и параметрам.

`management.build_management()` собирает один bundle с финансами, альтернативами, расширенной аналитикой и коалицией. `submission_content.documents()` читает именно этот bundle; `submission_pdf` рисует нативные таблицы, полосы и линии. UI, CSV, записка, стресс-лист и слайды поэтому не имеют независимых числовых констант.

Новые API: option применяет объявленный план и возвращает результат через тот же адаптер; coalition заново считает выбранный состав; shadow/frontier работают по проверенному snapshot. React редактирует все A16-A22 без изменения кода и хранит их вместе с workspace. `case_source/` по-прежнему только читается и проверяется SHA-256.
