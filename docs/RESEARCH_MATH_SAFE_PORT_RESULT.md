# KOSMOS · выборочный перенос математики

Статус: реализованы A/B и optional C. Авторские проверки; без subagents и независимой агентной приёмки.

## Фактическая база

- По подтверждению пользователя приняты последние исходники `C:/Users/Admin/Desktop/АХАКАТОН_КОСМО/frontend`, включая шесть разделов, Budget.tsx и вторичную кнопку «Обзор решения». Сокомандник завершил правки.
- Корень не имеет Git. История Session 1/2: `delivery/github-publish`, main, HEAD `c7c683d4c881c33532a0fe34f9f863f88aa2d1a1`, ahead 8; dirty App.tsx, Experience.tsx, experience.css, pitch-experience.spec.ts и dist сохранены.
- Эта работа: отдельный Git worktree `research-math-safe-port`, ветка `feature/research-math-safe-port`, тот же HEAD; изменения оставлены незакоммиченными. Последние корневые исходники перенесены по проверенному manifest. Устаревшие UI-файлы удалены только в новой копии; исходные деревья не перезаписывались.
- Большой Git diff включает унаследованную переработку frontend. Наш объём относительно принятого снимка указан ниже. `research-inherited-source-hashes.json` отделяет его от предыдущей работы.
- Существующие population, девять ограничений, MCDA, sensitivity, Recovery/locks, comparison, паспорта, brief, маршруты и API client переиспользованы. Новых зависимостей, lockfiles, инфраструктуры или redesign нет.

## Перенесено и исправлено

- Локальный разрешённый ZIP `C:/Users/Admin/Downloads/CosmoHackathon--.zip`: прочитаны/выделены только advanced_analysis.py, reliability.py, portfolio_analysis.py и test_advanced_math.py. Provenance и hash ZIP: `research-donor.json`. Remote donor branch HEAD на момент проверки: `2ad04a74f85ac6e7f768d8c93f7fbe89c95a8168`; идентичность ZIP этому commit не утверждается.
- A: исследовательский C0, критическая надбавка, запас, feasible count; одинаковые cap/u/locks в диагностике, Recovery, сравнении и объяснении. Сравнение C0*(1+u)<=cap+EPS прямое, без преобразования cap и масштабной ошибки допуска. Recovery повторно проверяется публичным строгим адаптером и исследовательским условием.
- B: точная ступенчатая F(B), первый/следующий порог, прирост бюджета/VPUB, состав и обычное сравнение. Равные VPUB объединяются; изменения состава при равенстве сохраняются отдельно. Tie-break: VPUB, затем текущий MCDA rank. Карта MCDA и её победитель не заменены. Следующий состав отдельно проверен при текущем и новом cap.
- C: аналитическая коррелированная нормальная модель, выключена по умолчанию; фактические u/sigma/rho/q, условная вероятность, cap-mu, zq*sd и недостающий бюджет. Условия применимости, overflow/underflow, sigma=0, корреляция и ограничения нормальности проверены. sigma=.05 применяется только явным выбором.
- Отклонены donor TeamSettings, coalition/Shapley, regional equity, SHADOW_EXPERIMENTS, repair replacement, capital preservation, risk_premium, donor frontend/styles/build/lockfiles/config/results/materials. Никаких новых официальных параметров.
- Новый API `/api/research-math` загружается лениво. Результат отдельный; официальный ResultBundle, рекомендация, pointers и экспорт не расширены. Research не передаётся в обычный brief/export. Обычное сравнение получает канонический состав с явной подписью; исследовательские сравнения с повторной проверкой показаны в Budget Lab.
- Новые контролы используют существующий дизайн. Loading/error/empty/reset, AbortController, явная отмена и защита от поздних ответов; ключ включает весь запрос: selection, sources, scenario, weights, cap/u/risk/locks.
- Исправлены ошибки новых тестовых фикстур/селекторов: глубокая копия дубликатов, summary с подписью, навигационные кнопки, повторное раскрытие после возврата. Старые assertions и тесты не ослаблялись.

## Проверки

Команды выполнялись из feature-копии; Python: `../.venv/Scripts/python.exe`, `PYTHONUTF8=1`; browser URL `http://127.0.0.1:8013`.

| Команда / доказательство | Результат |
|---|---|
| `-B -m unittest discover -s tests -p test_research_math.py -v` после A/B | exit 0, 7/7 |
| `-B -m unittest discover -s tests -p test_research_risk.py -v` | exit 0, 4/4, 60 000 seeded samples |
| `-B -m unittest discover -s tests -p "test_*.py" -v` | exit 0, 22/22, включая прежние 11 intelligence tests |
| `-B -m unittest discover -s tests -p test_research_math.py -k supplement -v` | exit 0, ещё 2/2: ties, actual settings, источники, lazy isolation |
| `-B tests/m3_independent.py --output out/research-m3` | exit 0, 430 473 assertions, все 5 групп PASS |
| `npm --prefix frontend run build` | final exit 0, TypeScript + Vite |
| Полный `npm --prefix frontend run test:browser -- --workers=1` | 41/41 существующих PASS; новый тест упал на селекторе. Прогон остановлен, исправленные новые тесты повторены отдельно |
| `test:browser -- tests/research-math.spec.ts --workers=1` | final exit 0, 4/4; `out/research-verified-browser.log` |
| Дополнительный targeted `-g "loading, API error"` | exit 0; надбавка + FLOOD A lock + пустой Recovery |
| Дополнительный targeted `-g "mobile research"` после выравнивания checkbox | exit 0; без горизонтального overflow |
| `test:browser -- tests/research-legacy-smoke.spec.ts --workers=1` | exit 0, 2/2: JSON roundtrip, constructor/Reset, 3 PDF hashes |
| `-B tests/session2_smoke.py --url http://127.0.0.1:8013 --output out/research-api-smoke.json` | exit 0, 49 проверок, 69 protected files |
| `-B tests/research_port_smoke.py` | exit 0, 243 проверки, final live API + hashes |
| `git diff --check` | exit 0 |

Контрольные числа получены из вычислений: C0=1150.8; critical_u=≈0.02537365311; counts u=0:1031/143, .05:648/1, .10:151/0; F(1180)=1370.4, следующий порог1186.5 даёт1410, F(1190)=1410. В интерфейсе не хардкодированы.

Проверены constructor, comparison, official BASE/STRESS, sensitivity, Recovery/locks, financing, brief, import/export, активные PDF, «Обзор решения», Reset, desktop/mobile. Скриншоты: `frontend/out/research-risk-desktop.png`, `frontend/out/research-mobile.png`.

Ограничение покрытия: 47 уникальных browser-сценариев проверены по частям (41 существующий + 4 новых + 2 smoke); единого последнего полного зелёного browser-прогона не заявляем. Старый `tests/m6_browser.mjs` использует прежние пять разделов и не запускался (NOT VERIFIED как harness); JSON/PDF/constructor-сценарии проверены новым smoke на актуальных маршрутах. Исторический `tests/verify_case.py`, уже присутствовавший в принятом корне, не выполнялся и не выдаётся за независимую проверку.

## Сохранность

Фактические hashes до/после совпали: 161 файл исходной базы, шесть M0 root-originals и 63 config/source/active-result файла feature-копии. Отдельный прежний smoke проверил свои 69 protected files. Активные M4/M5, официальная рекомендация и все PDF сохранены.

| Файл | SHA-256 |
|---|---|
| `config/m3_decision.json` | `a1c767672abb6d2c2b8fe0692fc842399b78a3be671ad1c62069263bfdfeb900` |
| `results/m3_decision.json` | `4f4a3126b8ff5d8a2b12cd465ac566cc77da24aabac25c8854b091e2835661d2` |
| `results/m4_current.json` | `6ea919a5727426ae8be152ff95f8b2e5bb3a579c03e7dd4c699d27a198336f22` |
| `results/m5/94d828a332ed40a9/note.pdf` | `43760eb1ef9d009c53177b4b8f09f795bef25d0949511da0d8569e81b5882ba9` |
| `results/m5/94d828a332ed40a9/slides.pdf` | `07832011a1a6e5c2a5379dbb878a1f55b4f56abefa69a2095d4be041e6827b71` |
| `results/m5/94d828a332ed40a9/stress.pdf` | `65382c2407ba776c68fc44f5283685f00a4d46d1d757eccc0ae9932f52fd3bf2` |
| `results/m5_current.json` | `e4f29e3564b01c2eb93161d45585dcc63b804cbbcf2f5b8a3bc8f11f664b887d` |

## Наши изменённые файлы относительно принятого frontend

- `backend/app/intelligence.py`, `backend/app/main.py` — совместимые расширения; новые `research_math.py`, `research_risk.py`.
- `frontend/src/Budget.tsx`; новый `frontend/src/ResearchMath.tsx`; новый build текущего frontend/dist. Shared UI, styles, routes, App, API client, веса и каноническое ядро не менялись относительно принятой базы.
- Новые `tests/test_research_math.py`, `tests/test_research_risk.py`, `tests/research_port_smoke.py`, `frontend/tests/research-math.spec.ts`, `frontend/tests/research-legacy-smoke.spec.ts`.
- `docs/research-*.json`, `docs/research-math-api.md`, этот отчёт; evidence/logs в `out/`. Корневое evidence только в `reports/evidence/research-math-safe-port/`.

## Передача

- Совместимость с последним подтверждённым frontend проверена; integration blockers не осталось. Feature-копия готова к локальному ревью. Не копировать весь её Git diff поверх старой версии: он содержит также унаследованные UI-изменения.
- Preview: http://127.0.0.1:8013/ . «Стресс → Корректировка бюджета → Удорожание и эффект изменения бюджета». При пустом конструкторе сначала загрузить сохранённое решение.
- Ничего не commit/push/deploy. Официальные delivery/PDF не пересобирались. Docker/release-pass/публикация: NOT VERIFIED и вне этого этапа.
- Модель риска условна и не калибрована по реальным данным. q<0.5 даёт отрицательный квантильный резерв; это явно раскрыто. Нет обещания отсутствия всех регрессий за пределами выполненных проверок.
