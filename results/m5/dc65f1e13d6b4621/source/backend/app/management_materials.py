"""Editable M4 narrative from the same computed release as the application.

Only layout/export to final PDFs is deferred to M5. Financial numbers are never
duplicated as editorial constants. Paragraphs describing proposals come from the
versioned management configuration included in the release identity.
"""
from __future__ import annotations

import json


def number(value, digits=6):
    if value is None:
        return "не задано"
    if isinstance(value, bool):
        return "да" if value else "нет"
    if isinstance(value, (float, int)):
        return f"{value:.{digits}f}".rstrip("0").rstrip(".").replace(".", ",")
    return str(value)


def selection(rows):
    return ", ".join(f"{r['lot_id']} {r['mode_id']}" for r in rows)


def bullets(values):
    return "\n".join(f"- {x}" for x in values)


def stable_value(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value)


def table(headers, rows):
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    return "\n".join(["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"] +
                     ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows])


def finance_table(bundle):
    fields = ["c0_mrub", "opex_mrub_per_year", "anchor_cash_mrub_per_year", "commercial_cash_mrub_per_year", "cash_mrub_per_year", "net_operating_balance", "lot_funding_gap"]
    rows = [[f"{r['lot_id']} {r['mode_id']}"] + [number(r[f]) for f in fields] for r in bundle["finance"]["rows"]]
    totals = bundle["finance"]["totals"]
    rows.append(["Итого"] + [number(totals[f]) for f in fields[:-1]] + [number(totals["sum_lot_funding_gaps"])])
    return table(["Сервис", "C0", "OPEX", "Anchor", "Commercial", "CASH", "Баланс", "Адресный gap"], rows)


def alternative_table(bundle):
    return table(["Стратегия / состав", "C0", "OPEX/год", "VPUB/год", "CASH/год", "KCASH", "Баланс/год", "Net gap / lot gaps", "BASE / STRESS"],
        [[f"{a['strategy_id']}: {selection(a['selection'])}",
          *[number(a["finance"]["totals"][f]) for f in ("c0_mrub", "opex_mrub_per_year", "vpub_mrub_per_year", "cash_mrub_per_year", "kcash", "net_operating_balance")],
          f"{number(a['finance']['totals']['portfolio_funding_gap'])} / {number(a['finance']['totals']['sum_lot_funding_gaps'])}",
          f"{a['scenarios']['BASE']['status']} / {a['scenarios']['STRESS']['status']}"] for a in bundle["alternatives"]])


def roadmap_table(bundle):
    return table(["Этап / месяцы", "Результат и владелец", "Ресурс и подтверждение", "Зависимость / приёмка / перенос"],
        [[f"{r['id']} / {r['start_month']}–{r['end_month']}", f"{r['result']}. Владелец: {r['owner']}",
          f"{r['resources']}. Подтверждает: {r['resource_confirmer']}. {r['availability']}",
          f"{r['dependency']}. Приёмка: {r['acceptance']}. Перенос: {r['defer_if']}"] for r in bundle["configuration"]["roadmap"]])


def render_documents(bundle):
    config = bundle["configuration"]
    # Retained /2 and /3 generations must still render byte-for-byte if a new
    # publication fails. Version only changed editorial fragments, not readers.
    organizer_revision = bundle["identity"].get("release_contract_version") == "kosmos-management-release/4"
    methodology_uri = ("methodology.md" if bundle["identity"].get("release_contract_version") == "kosmos-management-release/2"
                       else "../../../../docs/methodology.md")
    procurement = ("Последовательность закупки: реестр потребностей/источники средств → права/общий контрольный набор → сопоставимые предложения → проект условий → подтверждение кассового обеспечения → ограниченный пилот → независимая приёмка → эксплуатация. Условия и суммы — предложения, не правовое заключение или заключённый договор.")
    if organizer_revision:
        procurement = ("Закупщик подтверждает потребность и средства, зрелость именно приобретаемого результата, реальный спрос, квалифицированные предложения и критичность. "
                       "Доказанно пригодный зрелый сервис принимается по измеримому результату; неопределённое местное применение проверяется ограниченным пилотом и поэтапной приёмкой. "
                       "Права, контрольный набор и кассовое обеспечение нужны до обязательств, независимая приёмка — до расширения. "
                       "Одна схема не универсальна, readiness не TRL; это проектное предложение, не правовое заключение или заключённый договор (O1, PDF с.7–11).")
    money = bundle["finance"]["totals"]
    stress = bundle["stress"]
    horizon = next(a["value"] for a in bundle["assumptions"]["assumptions"] if a["id"] == "A03")
    runs = bundle["sensitivity"]["runs"]
    changes = sum(r["leader"]["selection"] != bundle["selection"] for r in runs)
    scope = selection(bundle["selection"])
    intro = (f"Сохранённый состав: **{scope}**. Release: `{bundle['release_id']}`. "
             f"Вход: `config/m3_decision.json`; management и assumptions включены в identity. "
             "Все суммы получены повторным Python-расчётом; правила финансирования и внедрения — предложения команды, "
             "реальные договоры и достигнутые KPI не заявлены. Числа округлены только при отображении; полная точность в JSON/CSV.")
    boundary = ("C0 — млн руб. при запуске; OPEX, anchor, commercial, CASH и gaps — млн руб./год устойчивой эксплуатации. "
                "VPUB — отдельная синтетическая общественная шкала в млн руб./год. KCASH — только отношение сумм CASH/OPEX.")
    summary = (f"Рекомендуется условно запустить {scope}. C0 {number(money['c0_mrub'])}; OPEX {number(money['opex_mrub_per_year'])}; "
               f"VPUB {number(money['vpub_mrub_per_year'])}; CASH {number(money['cash_mrub_per_year'])}; KCASH {number(money['kcash'],9)}. "
               f"Баланс {number(money['net_operating_balance'])}, портфельный gap {number(money['portfolio_funding_gap'])}, "
               f"сумма положительных lot gaps {number(money['sum_lot_funding_gaps'])}. Указанная сумма адресных gaps обеспечивается отдельными "
               "предложенными обязательствами, без автоматического переноса денег между договорами.")
    stress_text = (f"**{stress['action']} — сохранить состав.** Стоимость прежнего портфеля C0 {number(money['c0_mrub'])} не меняется. "
                   f"Лимит BASE {number(stress['base']['c0_limit'])} → STRESS {number(stress['stress']['c0_limit'])}; "
                   f"запас {number(stress['base']['c0_margin'])} → {number(stress['stress']['c0_margin'])}. "
                   f"Формальный статус {stress['base']['status']} / {stress['stress']['status']}. "
                   "Остальные денежные суммы, VPUB, индексы, режимы, общественный доступ и адресный gap остаются прежними. "
                   "Бюджетный запас не является выделенным финансированием или OPEX-резервом.")
    finance = finance_table(bundle)
    alternatives = alternative_table(bundle)
    sensitivity = table(["Изменение веса", "Лидер", "Score лидера", "Место исходного"],
                        [[f"{r['criterion']} × {number(r['multiplier'])}", selection(r['leader']['selection']), number(r['leader']['score'],9), number(r['original_choice_rank'])] for r in runs])
    roles_labels = {"buyer":"Закупщик", "c0_payer":"Ведущий плательщик C0", "anchor_payer":"Плательщик anchor", "commercial_payer":"Плательщики commercial", "gap_payer":"Плательщик адресного gap", "operator":"Оператор / плательщик OPEX", "supplier":"Поставщик", "acceptor":"Независимый приёмщик", "user":"Пользователь", "decision_owner":"Владелец решения", "public_beneficiary":"Общественный получатель"}
    user_rows = [[f"{s['lot_id']} {s['mode_id']} / {s['territory']}", f"{s['roles']['user']}. {s['need']}", s['action'], s['expected_effect']] for s in bundle['services']]
    funding = []
    contracts = []
    kpis = []
    risks = list(config["portfolio_risks"])
    replication = []
    for s in bundle["services"]:
        lot = s["lot_id"]
        funding.append(f"### {lot} {s['mode_id']}: условные обязательства\n\n" +
            table(["Поток", "Сумма / единица", "Плательщик → получатель", "Срок / основание"],
                  [["Полный C0", f"{number(a['amount'])} {a['unit']}", f"{a['payer']} → {s['roles']['operator']}", s['c0_timing']] for a in s["c0_funding"]] +
                  [[f["kind"], f"{number(f['amount'])} {f['unit']}", f"{f['payer']} → {f['payee']}", f"{f['timing']} {f['purpose']}"] for f in s["flows"]]) +
            f"\n\nУсловия согласия: {s['agreement_condition']}\n\nЛиквидность: {s['liquidity_owner']}. {s['liquidity_gate']}")
        contracts.append(f"### {lot} {s['mode_id']}: доступ и ответственность\n\n" +
            table(["Функция", "Предлагаемый участник"],[[label,s['roles'][key]] for key,label in roles_labels.items()]) +
            "\n\n" + "\n\n".join([s["access_rationale"],"Предмет: "+s["contract_subject"],"Общественный слой: "+s["public_layer"],
                                     "Ограничения данных: "+s["restricted_data"],s["rights"],"Приёмка: "+s["acceptance"],
                                     "Оплата: "+s["payment_condition"],"При дефекте: "+s["failure_response"]]) +
            "\n\nИсточники: " + ", ".join(s["source_refs"]) + "; допущения: " + ", ".join(s["assumption_refs"]) + ".")
        for k in s["kpis"]:
            kpis.append(f"### {lot} / {k['name']}\n\n" +
                table(["Поле протокола", "Предложенное правило"],[["Статус / baseline / цель", f"{k['status']}; baseline неизвестен, цель неизвестна; утверждение {k['approve_phase']}"],
                ["Единица / период / объекты",f"{k['unit']}; {k['period']}; {k['objects']}"],
                ["Числитель / знаменатель",f"{k['numerator']} / {k['denominator']}"],["Пропуски",k['missing']],
                ["Источник / владелец",f"{k['source']}; {k['owner']}"],["Приёмка",k['acceptance']]]))
        risks.extend(s["risks"])
        r = s["replication"]
        replication.append([lot,r["core"],r["adaptation"],f"{r['first_pilot']} → {r['next_site']}",f"{r['experience']}. Условие: {r['gate']}"])
    risk_table = table(["Риск / владелец", "Триггер / последствие", "Действие / остаток"],
                       [[f"{r['risk']}; {r['owner']}",f"{r['trigger']}. {r['consequence']}",f"{r['action']}. Остаток: {r['residual']}"] for r in risks])
    dependency_table = table(["Зависимость / сервисы", "Владелец / подтверждение", "Остаток"],
        [[f"{d['dependency']}; {', '.join(d['services'])}; фактический поставщик неизвестен",f"{d['owner']}; {d['gate']}",d['residual']] for d in config['shared_dependencies']])
    switch = config["supplier_switch"]
    switch_text = (switch['competition'] + "\n\nТриггеры:\n\n" + bullets(switch['triggers']) + "\n\nПоследовательность:\n\n" +
                   " → ".join(switch['sequence']) + "\n\nПередаваемый комплект:\n\n" + bullets(switch['payload']) +
                   f"\n\n{switch['interface']}\n\n{switch['costs_and_time']}\n\n{switch['continuity']}\n\n{switch['residual']}")
    export_table = table(["Сервис", "Формат / контрольный набор", "Владелец перехода"],
                         [[s['lot_id'],f"{s['export_format']} Контроль: {s['control_set']}",s['migration_owner']] for s in bundle['services']])
    source_text = table(["Источник", "Прочитанное положение", "Граница / проверка"],
        [[f"{key}: [{s['title']}]({s['uri'] if s['uri'].startswith('https://') else '../../../../'+s['uri']})",s['claim'],f"{s['limitation']}. {s['checked']}"] for key,s in sorted(config['sources'].items())])
    assumption_text = table(["Допущение", "Статус / значение", "Ограничение или уточнение"],
        [[a['id']+' '+a['topic'],a['status']+': '+stable_value(a.get('value') if a.get('value') is not None else 'неизвестно'),a.get('limitation',a.get('reason',''))+' '+a.get('resolve_by','')] for a in bundle['assumptions']['assumptions']])
    method = ("Модель применима к выбору небольшой четвёрки из синтетических лотов при заданных условиях: "
              "она воспроизводимо отделяет допустимость от предпочтений, а содержательная схема отдельно проверяет реализуемость. "
              "Исходные S4/S5 не заменяются рыночными оценками. По каждому лоту C0/OPEX/VPUB/anchor/commercial умножаются "
              "на соответствующий коэффициент A/B/C; CASH=anchor+commercial. Портфельные денежные величины и VPUB суммируются, "
              "KCASH=сумма CASH/сумма OPEX. t_rep/readiness/resilience/scale — простые средние. Полные формулы/пороговые источники: "
              f"[methodology.md]({methodology_uri}), result.provenance и result.scenarios в JSON. "
              "SSA не добавляет территорию; PNT/InSAR нормализуются в одну группу. "
              "Расшифровка t_rep и методики исходных индексов неизвестны; это только заданный индекс. "
              "Налоги, долг, ставка, сезонность, остаточная стоимость, синергии, миграция и предотвращённый ущерб не моделируются.")
    constraints = table(["Условие", "Факт", "BASE лимит / статус", "STRESS лимит / статус"],
        [[b['condition'],number(b['fact']),f"{number(b['limit'])} / {b['status']}",f"{number(t['limit'])} / {t['status']}"]
         for b,t in zip(bundle['result']['scenarios']['BASE']['diagnostics'],bundle['result']['scenarios']['STRESS']['diagnostics'])])
    weights = table(["Критерий", "Применённый вес"],[[key,number(value)] for key,value in sorted(bundle['weights']['applied'].items())])
    selection_method = (f"Полный перебор: {bundle['population']['total']} сочетаний, BASE-допустимы {bundle['population']['scenarios']['BASE']['feasible']}, "
        f"STRESS-допустимы {bundle['population']['scenarios']['STRESS']['feasible']}. "
        "Сначала все обязательные ограничения, затем weighted MCDA по заранее объявленным предпочтениям Architect. "
        "R — все BASE-допустимые этой версии, одна шкала для BASE/STRESS/альтернатив. "
        "Выгоды нормируются (x-min)/(max-min), затраты C0/OPEX — (max-x)/(max-min); score — сумма вес×норма. "
        "Постоянный критерий даёт нулевой различающий вклад без переноса веса. "
        "Равенство неокруглённых score разрешается меньшим C0, затем лексикографическим составом. "
        "OPEX/KCASH и C0 частично повторяют финансовые предпочтения, независимость критериев/равенство интервалов индексов не установлены. "
        "Score — вспомогательный индекс предпочтений, не оценка жюри, вероятность или деньги.")
    alt_explanations = []
    for a in bundle['alternatives']:
        delta = a['delta']
        alt_explanations.append(f"**{a['strategy_id']}**: {a['rationale']} "
            f"Общественное ядро: {', '.join(a['public_core_ids'])}. "
            f"ΔC0 {number(delta['c0_mrub'])}, ΔOPEX {number(delta['opex_mrub_per_year'])}, "
            f"ΔVPUB {number(delta['vpub_mrub_per_year'])}, ΔCASH {number(delta['cash_mrub_per_year'])} "
            "(альтернатива минус рекомендация)." + (f" Совпадение: {a['same_portfolio_as']}." if a['same_portfolio_as'] else ""))
    roadmap = roadmap_table(bundle)
    advanced = bundle['advanced_analysis']
    coalition = bundle['coalition']
    advanced_summary = (
        "Параметры команды: `optimism_uplift={}`, `sigma={}`, `rho={}`, `confidence={}`, `alpha={}`, `phi={}`.\n\n".format(
            *[number(advanced['settings'][key]) for key in ('optimism_uplift','sigma','rho','confidence','alpha','phi')]) +
        table(["Надбавка", "BASE число / max VPUB", "STRESS число / max VPUB"],
              [[number(100*r['uplift'])+' %', f"{r['BASE']['feasible']} / {number(r['BASE']['max_vpub_mrub_per_year'])}",
                f"{r['STRESS']['feasible']} / {number(r['STRESS']['max_vpub_mrub_per_year'])}"] for r in advanced['optimism_ladder']]) +
        "\n\nКлассификация BASE: " + ", ".join(f"тип {key} — {advanced['stress_response_population']['counts'][key]}" for key in ('0','1','2','3')) +
        f". Надёжные при sigma=5 %: BASE {advanced['reliability_population']['BASE']['reliable']}, STRESS {advanced['reliability_population']['STRESS']['reliable']}; "
        f"цена надёжности {number(advanced['reliability_population']['price_of_reliability_mrub_per_year'])} VPUB/год.\n\n" +
        f"Шепли: стоимость союза {number(coalition['grand_cost_mrub'])}, экономия {number(coalition['cooperation_savings_mrub'])}; "
        f"ядро {'PASS' if coalition['core']['ok'] else 'FAIL'}, {coalition['core']['checked']} неравенств. Формулы, кривые, теневые цены, региональные частоты и торнадо находятся в advanced_analysis того же bundle.")
    reproduce = ("`python -X utf8 -B scripts/build_management.py` пересчитывает принятую конфигурацию и создаёт "
                 "`results/m4_current.json` — единую ссылку на проверенный пятифайловый выпуск в `results/m4_releases/`. Команда `--current` проверяет и показывает его файлы. "
                 "Они доступны из экрана «Реализация», который показывает только сохранённую рекомендацию. "
                 "Ручные портфели и новые веса не наследуют её договорные пояснения. "
                 "Финальная PDF-вёрстка записки/отдельного стресса/презентации и визуальная проверка объёма — M5; "
                 "чистая поставка — M7. Публичная публикация не выполнена.")
    note_sections = [
        ("1. Рекомендация и границы",summary+"\n\n"+boundary+"\n\n"+bullets(config['choice_rationale'])),
        ("2. Потребности, действия и общественная ценность",table(["Сервис / архетип","Пользователь и потребность","Действие","Ожидаемый эффект и ограничение"],user_rows)+"\n\nПолучатель общественной пользы может не быть плательщиком. Эффекты не конвертируются в дополнительный CASH и не суммируются повторно по общим событиям."),
        ("3. Модель, единицы и исходные условия",method+"\n\n"+constraints),
        ("4. Метод выбора и условность предпочтений",selection_method+"\n\n"+weights+f"\n\nВ {changes} из {len(runs)} опытов меняется лидер. Это зависимость от предпочтений, не обещание универсальной устойчивости.\n\n"+sensitivity),
        ("5. Альтернативы и цена компромисса",alternatives+"\n\n"+boundary+f"\n\nРазличных портфелей: {bundle['distinct_strategy_portfolios']}; совпавшие роли стратегий отдельно не считаются. Политика без межлотовых трансфертов одинакова.\n\n"+"\n\n".join(alt_explanations)),
        ("6. Бюджет, плательщики и условия финансирования",finance+f"\n\nПортфельный gap: {number(money['portfolio_funding_gap'])}; сумма адресных lot gaps: {number(money['sum_lot_funding_gaps'])}.\n\n"+bullets(config['financing_notes'])+"\n\n"+"\n\n".join(funding)),
        ("7. Доступ, закупка, договоры и ответственность",table(["Режим","Предлагаемая интерпретация","public core"],[[key,a['label']+'. '+a['terms'],number(a['public_core'])] for key,a in config['access_proposals'].items()])+"\n\n"+procurement+"\n\n"+"\n\n".join(contracts)),
        ("8. Управленческое решение при STRESS",stress_text+f"\n\nОтветственный: {stress['owner']}.\n\n"+bullets(stress['conditions'])+f"\n\n{stress['timing']}"),
        ("9. Риски, конкуренция и тиражирование услуг",risk_table+"\n\nОбщие источники и наземные узкие места:\n\n"+dependency_table+"\n\n### Практическая смена поставщика\n\n"+switch_text+"\n\n"+export_table+"\n\n### Перенос сервиса\n\n"+table(["Сервис","Ядро","Местная адаптация","Очередь пилотов","Передача опыта / условие"],replication)+"\n\nИндексы scale/resilience остаются оценками кейса; не доказывают приёмку, независимость источников или готовность переноса. Масштабирование веб-приложения не заменяет эту схему."),
        ("10. Дорожная карта, KPI и проверяемые границы",f"Горизонт {horizon} месяцев — предложение A03, не календарь организаторов и не бюджетный период годовых CASH/OPEX.\n\n"+roadmap+f"\n\n{config['pilot_order']}\n\n"+bullets(config['kpi_protocol'])+"\n\n"+"\n\n".join(kpis)+"\n\n### Допущения и неизвестные\n\n"+assumption_text+"\n\n### Источники и применимость\n\n"+source_text+"\n\n### Воспроизведение\n\n"+reproduce),
        ("11. Дополнительные математические показатели", advanced_summary),
    ]
    note = "# Портфель космических сервисов — содержательная управленческая записка M4\n\n"+intro+"\n\nСодержание для финальной вёрстки; число страниц этого Markdown не является проверкой PDF-объёма.\n\n"+"\n\n".join(f"## {title}\n\n{body}" for title,body in note_sections)+"\n"
    gap_services = [s for s in bundle['services'] if s['finance']['lot_funding_gap']>0]
    stress_note = "# Стресс-сценарий — содержание отдельного резюме M4\n\n"+intro+"\n\n"+stress_text+"\n\n"+summary+"\n\n"+boundary+"\n\n"+"\n\n".join(f"**{s['lot_id']} — адресное обязательство {number(s['finance']['lot_funding_gap'])} млн руб./год.** Плательщик: {s['roles']['gap_payer']}. {config['payment_timing']['additional_support']}" for s in gap_services)+f"\n\nОтветственный: {stress['owner']}. Условия: "+"; ".join(stress['conditions'])+f".\n\n{stress['timing']}\n\nИсточник: S1/S5; полные проверки: result.scenarios и stress в JSON текущего выпуска (путь: scripts/build_management.py --current). Финальная одна страница PDF и визуальная проверка — M5.\n"
    # Twelve concrete slides: concise on-slide statements plus speaking notes.
    slide_data = [
        ("Решение заказчика",summary,"Условная рекомендация; все договоры/ресурсы подтверждаются до обязательств. "+boundary),
        ("Пользователи и общественная ценность",table(["Сервис","Пользователь → действие"],[[s['lot_id'],s['roles']['user']+' → '+s['action']] for s in bundle['services']]),"Ожидаемый эффект не является доказанным ущербом; ENV/FLOOD общественное ядро, AGRI/TRANS договорные клиенты."),
        ("Прозрачная модель",boundary+"\n\nCASH=anchor+commercial; KCASH=сумма CASH/сумма OPEX. Портфельные суммы и средние индексов; BASE/STRESS отличаются лимитом C0.",method),
        ("Правила выбора",weights+f"\n\nЕдиная BASE-шкала; {changes} из {len(runs)} опытов меняют лидера.",selection_method),
        ("Сопоставимые альтернативы",alternatives,"Разные задачи и режимы. Низкий нетто-gap не покрывает все договоры: адресные gaps показаны при одинаковом запрете трансфертов. "+" ".join(alt_explanations)),
        ("Почему этот состав",bullets(config['choice_rationale']),"Основная слабость — условность предпочтений, общий EO-источник и неподтверждённые местные условия; формальная допустимость не равна готовности договора."),
        ("Кто оплачивает запуск и эксплуатацию",finance+"\n\n"+table(["Лот","Полный C0 — ведущий плательщик","Адресный gap — плательщик"],[[s['lot_id'],s['roles']['c0_payer'],s['roles']['gap_payer']] for s in bundle['services']]),"\n\n".join(funding)+"\n\n"+bullets(config['financing_notes'])),
        ("Доступ и ответственность",table(["Сервис","Общественный слой / ограничения","Приёмщик"],[[s['lot_id']+' '+s['mode_id'],s['public_layer'],s['roles']['acceptor']] for s in bundle['services']]),"A/B/C — предложения интерпретации коэффициентов. Предмет/права/экспорт/независимая приёмка связаны с оплатой; данные полей/телематики не открываются автоматически."),
        ("STRESS: сохранить с условиями",stress_text,stress['owner']+'. '+"; ".join(stress['conditions'])+'. '+stress['timing']),
        ("Риски и перенос услуг",table(["Сервис","Физический риск","Ядро / адаптация"],[[s['lot_id'],s['risks'][0]['risk'],s['replication']['core']+' / '+s['replication']['adaptation']] for s in bundle['services']]),switch_text+"\n\nОбщий EO-источник и наземная проверка связывают все услуги; резервный обработчик может не резервировать первичные данные."),
        ("Дорожная карта и KPI",table(["Месяцы","Результат / владелец"],[[f"{r['start_month']}–{r['end_month']}",r['result']+' / '+r['owner']] for r in config['roadmap']]),config['pilot_order']+'\n\n'+bullets(config['kpi_protocol'])+'\n\n'+table(["Сервис","KPI / владелец / источник"],[[s['lot_id'], '; '.join(k['name']+' ('+k['unit']+'), '+k['owner']+', '+k['source'] for k in s['kpis'])] for s in bundle['services']])),
        ("Живая проверка и решение о следующем шаге","Реализация → загрузить сохранённый состав в конструктор → BASE/STRESS → изменить лот/режим и проверить ограничения → сравнить альтернативы → скачать JSON/CSV и материалы.",reproduce+" Полный протокол ограничений виден в result.scenarios; старые договорные условия не приписываются изменённому ручному портфелю."),
    ]
    if organizer_revision:
        for index, extra in {
            1: "По O3 (PDF с.3–4,7) различать продукт, действие и получателя: условный клубный доступ AGRI/TRANS и территориальная открытая сводка ENV/FLOOD. A/B/C не научная классификация.",
            7: procurement + " Вклады сторон, владелец требований, обратная связь реальных пользователей и принятая версия раскрыты в каждой карточке (O2 с.10–11).",
            9: "Внезапная потеря доступа отдельно от планового перехода: уведомление, устаревание/пропуски, остановка неподдерживаемого результата и только ограниченный реальный резерв. История не заменяет новую съёмку/GNSS (O4 физ.с.84,88–89; O5 с.12–14).",
            10: "Качество услуги, применение и эффект — разные уровни, все десять KPI плановые. Зрелый измеримый результат не требует обязательной НИОКР; местная неопределённость проверяется этапами.",
            11: "O1–O5 прочитаны по предоставленным физическим страницам; DOI и внешняя библиография заново не проверялись. Полные PDF частные; идентификация, тезисы и границы сохранены в sources.",
        }.items():
            title, body, notes = slide_data[index]
            slide_data[index] = (title, body, notes + " " + extra)
    presentation = f"# Презентация — содержательный сценарий M4, {len(slide_data)} слайдов\n\n"+intro+"\n\nРедактируемый сценарий с текстом слайда и заметками докладчика; финальная компоновка PDF — M5.\n\n"+"\n\n".join(f"## Слайд {i}. {title}\n\n{body}\n\n**Заметки докладчика:** {notes}" for i,(title,body,notes) in enumerate(slide_data,1))+"\n\nИсточники и ограничения: [управленческая записка](management-note-draft.md), [реестр](../../../../docs/sources.md).\n"
    return {"management-note-draft.md":note,"stress-summary-draft.md":stress_note,"presentation-draft.md":presentation}
