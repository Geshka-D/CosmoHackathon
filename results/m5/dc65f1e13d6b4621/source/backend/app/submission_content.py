"""Data-bound editorial source for the note, stress sheet and slide deck."""
from .submission_pdf import number as n


def selection(rows):
    return ' · '.join(f"{row['lot_id']} {row['mode_id']}" for row in rows)


def p(text, **kw): return {'kind': 'p', 'text': text, **kw}
def h(text): return {'kind': 'h', 'text': text}
def table(headers, rows, **kw): return {'kind': 'table', 'headers': headers, 'rows': rows, **kw}
def page(title, *blocks): return {'title': title, 'blocks': list(blocks)}
def bars(labels, values, caption, **kw): return {'kind': 'bars', 'labels': labels, 'values': values, 'caption': caption, **kw}
def line(points, caption, **kw): return {'kind': 'line', 'points': points, 'caption': caption, **kw}
def link(text, uri): return {'kind': 'link', 'text': text, 'uri': uri, 'size': 8.1}


BOUNDARY = ('C0 - млн руб. при запуске. OPEX, CASH и gaps - млн руб./год эксплуатации. '
            'VPUB - отдельная синтетическая общественная шкала, млн руб./год. KCASH = сумма CASH / сумма OPEX.')


def _probability(brief, scenario='STRESS'):
    row = next(item for item in brief['scenarios'][scenario]['diagnostics'] if item['id'] == 'c0_limit')
    return row['probability']


def documents(b):
    config = b['configuration']; result = b['result']; finance = b['finance']; totals = finance['totals']
    advanced = b['advanced_analysis']; triad = advanced['strategic_triad']; coalition = b['coalition']
    equity = advanced['regional_equity']; frontier = advanced['frontier']; classifier = advanced['stress_response_population']
    ladder = advanced['optimism_ladder']; reliability = advanced['reliability_population']; shadow = advanced['shadow_prices']
    tornado = advanced['risk_tornado']; services = b['services']; scope = selection(b['selection'])
    settings = advanced['settings']; stress = b['stress']

    triad_rows = []
    for label, item in [('Текущая рекомендация', triad['current']), ('Максимум VPUB', triad['benefit_maximum']), ('После опциона', triad['after_option'])]:
        triad_rows.append([label, selection(item['selection']), n(item['metrics']['c0_mrub']), n(item['metrics']['vpub_mrub_per_year']),
                           n(item['metrics']['kcash'], 3), n(item['portfolio_funding_gap']), n(item['sum_lot_funding_gaps']),
                           n(100*_probability(item), 1)+' %', item['scenarios']['STRESS']['status']])
    ladder_rows = [[n(100*x['uplift'])+' %', x['BASE']['feasible'], n(x['BASE']['max_vpub_mrub_per_year']),
                    x['STRESS']['feasible'], n(x['STRESS']['max_vpub_mrub_per_year'])] for x in ladder]
    shadow_rows = []
    for base, stressed in zip(shadow['BASE']['experiments'], shadow['STRESS']['experiments']):
        shadow_rows.append([base['label'], n(base['delta_vpub_mrub_per_year']), n(stressed['delta_vpub_mrub_per_year'])])
    money_rows = [[row['lot_id']+' '+row['mode_id'], n(row['c0_mrub']), n(row['opex_mrub_per_year']), n(row['cash_mrub_per_year']),
                   n(100*row['lot_coverage_ratio'], 1)+' %', n(row['lot_funding_gap']), n(row['vpub_mrub_per_year'])]
                  for row in finance['rows']]
    money_rows.append(['Итого', n(totals['c0_mrub']), n(totals['opex_mrub_per_year']), n(totals['cash_mrub_per_year']),
                       n(100*totals['lot_coverage_ratio'], 1)+' %', n(totals['sum_lot_funding_gaps']), n(totals['vpub_mrub_per_year'])])
    coalition_rows = [[row['region']+' / '+row['lot_id'], n(row['standalone_mrub']), n(row['shapley_mrub']),
                       n(100*row['share'], 1)+' %', n(row['proportional_mrub']), n(row['equal_mrub'])]
                      for row in coalition['players']]
    risk_rows = [[row['risk'], n(100*row['critical_change_fraction'], 2)+' %', row['rule_id'], n(row['limit'])] for row in tornado]

    needs = {
        'AGRI': ('Агроном', 'карта зон -> полевая проверка -> решение о поливе', 'счётчики воды, полевой журнал и контуры сезона'),
        'ENV': ('Эколог и водопользователь', 'EO-сигнал -> проба -> решение по водозабору', 'журнал сигналов, проб и лабораторные протоколы'),
        'FLOOD': ('Штаб и дорожная служба', 'карта -> обследование -> защита, эвакуационная подготовка или маршрут', 'временные метки, штабной журнал и акты обследований'),
        'TRANS': ('Диспетчер', 'координаты/ETA -> проверка -> маршрутное решение', 'телематика, диспетчерский журнал и фактическое прибытие'),
    }
    tev = {
        'AGRI': ('полевое решение', 'водопользование и агростраховая проверка', 'следующий сезон', 'межсезонный ряд'),
        'ENV': ('место пробы', 'природоохранное планирование', 'новый эпизод', 'экологическая летопись'),
        'FLOOD': ('подготовка защиты', 'застройка и страховой анализ', 'готовность к редкому событию', 'история экстремумов'),
        'TRANS': ('маршрутное решение', 'доступность для грузополучателей', 'новые маршруты', 'история транспортной сети'),
    }
    note = []
    note.append(page('1. Решение: сохранить выбор и купить гибкость',
        p('Сохранённая рекомендация: '+scope+'. Она не заменена новой оптимизацией.', size=13),
        table(['C0','OPEX','CASH','VPUB','KCASH','BASE / STRESS'], [[n(totals['c0_mrub']),n(totals['opex_mrub_per_year']),n(totals['cash_mrub_per_year']),n(totals['vpub_mrub_per_year']),n(totals['kcash'],3),
              result['scenarios']['BASE']['status']+' / '+result['scenarios']['STRESS']['status']]], size=9),
        p(BOUNDARY), h('Главное управленческое действие'),
        p('Заранее включить в договор опцион TRANS A->B при подтверждённом лимите ниже 1 200 млн руб. Смена режима сохраняет созданный капитал; замена лота несёт безвозвратную долю alpha. Из 1 031 BASE-допустимого варианта 143 уже проходят STRESS, 86 чинятся режимами и 802 не пересобираются при alpha=0,30.'),
        h('Что изменилось в аналитике'),
        p('Добавлены надбавка на оптимизм, вероятностное соответствие и выводимый резерв, теневые цены, две кривые, стресс-классификатор, ремонт ближайшим соседом, распределение Шепли, региональная частота, критические сдвиги и полотовое покрытие. Все они помечены как показатели команды и происходят из того же bundle.'),
        p('Реальные договоры, поставщики, штат, baseline и достигнутые KPI не заявлены. Source hashes и input fingerprint встроены в PDF.', size=9)))

    need_rows = [[card['lot_id'], needs[card['lot_id']][0], needs[card['lot_id']][1], needs[card['lot_id']][2]] for card in services]
    tev_rows = [[card['lot_id'], *tev[card['lot_id']]] for card in services]
    note.append(page('2. Потребность, пользователь и полная ценность',
        p('Внешние числа обосновывают масштаб потребности, но не входят в синтетическую модель (A23). В 2021 году ущерб от паводков оценивался в 7,5 млрд руб. (E16). Benchmark Prithvi-EO 2.0: F1 98,1 % для гарей, 97,7 % для паводков и 60,7 % для оползней (O4); поэтому оползневый сигнал требует оператора и наземной проверки.'),
        table(['Лот','Пользователь','Сервис -> решение','Проверка эффекта'], need_rows, widths=[.6,1.1,2,1.7], size=7.9),
        h('VPUB как прокси Total Economic Value'),
        table(['Лот','Прямая','Косвенная','Опцион','Существование / наследование'], tev_rows, widths=[.5,1.1,1.6,1.1,1.5], size=7.8),
        p('CASH - плата отдельных пользователей. Полная ценность охватывает также неплатящих. Смешение линий создало бы двойной счёт и потеряло бы общественных получателей; поэтому они показаны отдельно. Основание: O3.', size=9)))

    diagnostics = []
    for base, stressed in zip(result['scenarios']['BASE']['diagnostics'], result['scenarios']['STRESS']['diagnostics']):
        diagnostics.append([base['id'], n(base['fact']), base['comparator']+' '+n(base['limit']), stressed['comparator']+' '+n(stressed['limit']), base['status']+'/'+stressed['status']])
    note.append(page('3. Каноническая модель и параметры команды',
        p('Канонический слой: lot value = source value x coefficient A/B/C; C0, OPEX, VPUB и CASH суммируются; CASH = anchor + commercial; индексы усредняются; KCASH = CASH/OPEX. Девять условий проверяются до рейтинга.'),
        table(['Условие','Факт','BASE','STRESS','Статус'], diagnostics, widths=[1.5,.7,1,1,.8], size=7.8),
        h('Текущие входы команды A16-A22'),
        table(['uplift','sigma','rho','confidence','alpha','phi'], [[n(settings['optimism_uplift']),n(settings['sigma']),n(settings['rho']),n(settings['confidence']),n(settings['alpha']),n(settings['phi'])]], size=8.5),
        p('Надбавка действует только на факт C0 в диагностике. Вероятностная модель: Var(C0)=sigma^2 C^2 [(1-rho)H+rho], H=sum(c_i/C)^2. Целевой резерв выводится из условия P(C0<=Lim)>=confidence. Эти величины не меняют исходные лоты.', size=9),
        p('Каждый показатель команды снабжён формулой, единицей и ссылкой на A16-A22 в bundle.json. По умолчанию sigma=0, чтобы канонический результат воспроизводился точно.', size=9)))

    rho_rows = [[n(item['inputs']['rho'],2), n(item['risk_premium_mrub'],1), n(100*item['target_reserve_share'],1)+' %'] for item in advanced['risk_premium_by_rho']]
    note.append(page('4. Стресс как надбавка на оптимизм и надёжность',
        p('1300/1180 - 1 = 10,17 %. Минимальная остаточная надбавка для оборудования и разработки в руководстве HM Treasury - 10 %; верхняя отправная оценка - 200 % (E8). Это сценарный ориентир, не изменение кейса.'),
        table(['Надбавка','BASE: число','BASE max VPUB','STRESS: число','STRESS max VPUB'], ladder_rows, widths=[.8,1,1.2,1,1.2], size=8.2),
        p('При 20 % нет допустимых вариантов даже в BASE. GAO E9: у 36 крупных проектов NASA совокупный рост стоимости почти 4,7 млрд долл. и 14 лет задержки при жизненном цикле не менее 70 млрд; эти данные подтверждают дисциплину сценария, но не калибруют его.'),
        h('Выводимый резерв при sigma=5 %, confidence=90 %'),
        table(['rho','Резерв, млн руб.','Доля к допустимой стоимости'], rho_rows, size=8.5),
        p(f"По буквальной закрытой формуле надёжны BASE {reliability['BASE']['reliable']} и STRESS {reliability['STRESS']['reliable']}; максимум STRESS VPUB {n(reliability['STRESS']['max_vpub_mrub_per_year'])}, цена надёжности {n(reliability['price_of_reliability_mrub_per_year'])} VPUB/год. Это воспроизводимое уточнение контрольной строки задания.", size=9)))

    note.append(page('5. Договорный опцион: три состояния одного состава',
        table(['Состояние','Режимы','C0','VPUB','KCASH','Gap портф.','Sum lot gaps','P STRESS','Статус'], triad_rows,
              widths=[1.25,1.5,.6,.65,.55,.65,.7,.65,.55], size=7.1),
        p('Текущий вариант имеет больший запас; максимум VPUB добавляет 171,0 единицы общественной ценности, но не проходит STRESS. TRANS A->B восстанавливает формальное соответствие без потери уже созданного капитала. Денежный портфельный gap после опциона равен нулю, но адресные lot gaps остаются и требуют явных обязательств.'),
        table(['Тип','Смысл','Число','Доля BASE'], [[key,classifier['labels'][key],classifier['counts'][key],n(100*classifier['shares'][key],1)+' %'] for key in ('0','1','2','3')], size=8.5),
        h('Договорная конструкция'),
        p('Триггер подтверждает межрегиональный заказчик; оператор проверяет применимость, уведомляет пользователей и сохраняет оговорённый базовый слой. Дополнительное соглашение задаёт действие, дату, права на историю и приёмку новых девяти проверок. Независимый приёмщик подтверждает исполнение. Гибкость проектируется заранее (E13; O1).'),
        p('Ближайший ремонт контрольного BASE-максимума до STRESS требует двух изменений и теряет 395,6 VPUB/год; одного изменения недостаточно.', size=9)))

    note.append(page('6. Теневые цены ограничений',
        p('Показатель команды: delta VPUB = max VPUB при изменённом условии - max VPUB при канонических условиях. Полный перебор использует ту же сохранённую популяцию.'),
        table(['Эксперимент','Delta VPUB BASE','Delta VPUB STRESS'], shadow_rows, widths=[2.7,1,1], size=8.5),
        p('Связывает бюджет. На участке 1180->1300 предельная общественная отдача 3,30 VPUB/год на 1 млн стартового бюджета; после 1300 до 1400 - 0,54. В локальном опыте STRESS дополнительные 10 млн дают 39,6 VPUB/год.'),
        h('Цена третьей технологической группы'),
        p('Ужесточение capability_groups до трёх стоит 77,4 VPUB/год в BASE и 220,4 в STRESS. Это конфликт диверсификации и общей платформы. Решение переносится в требования к форматам, открытым API и правам на историю, а не маскируется составом портфеля.'),
        p('Ослабление остальных проверенных условий не увеличивает максимум VPUB при указанных экспериментах; это локальные конечные разности, а не универсальные коэффициенты.', size=9)))

    eff_points = [[row['budget_mrub'], row['max_vpub_mrub_per_year']] for row in frontier['efficiency_curve']]
    survival_points = [[100*row['cut_share'], row['feasible']] for row in frontier['survival_curve']]
    note.append(page('7. Бюджетная эффективность и выживаемость',
        line(eff_points, 'F(B)=max VPUB среди вариантов, проходящих не-C0 условия и C0<=B. Зелёная зона 1180-1300.', x_label='Лимит C0, млн руб.', band=[1180,1300], markers=[1180,1300], height=170),
        table(['Первая точка','STRESS','BASE','Насыщение'], [['1123,5 -> 1020,4','1180 -> 1370,4','1300 -> 1766,0','1312,5 -> 1820,0']], size=8),
        line(survival_points, 'Число допустимых вариантов при сокращении лимита от BASE.', x_label='Сокращение бюджета, %', markers=[9.2,13.6], height=165),
        p('Бюджет -9,2 % снижает максимум VPUB на 22,4 %: эластичность 2,43. Пространство уменьшается с 1 031 до 145 вариантов около STRESS и обрывается до нуля при 13,6 %.', size=9)))

    note.append(page('8. Деньги по лотам и две линии результата',
        table(['Лот','C0','OPEX','CASH','Покрытие','Lot gap','VPUB'], money_rows, widths=[1,.75,.75,.75,.8,.75,.75], size=8.1),
        p(f"Портфельный gap {n(totals['portfolio_funding_gap'])}; сумма положительных lot gaps {n(totals['sum_lot_funding_gaps'])}. ENV A покрывает {n(100*finance['rows'][1]['lot_coverage_ratio'],1)} % и требует адресного обязательства {n(finance['rows'][1]['lot_funding_gap'])} млн руб./год сверх anchor. Положительный общий баланс не переводит деньги между договорами автоматически."),
        h('Карта потоков'),
        p('Денежная линия: ведущие плательщики C0 и пользователи anchor/commercial -> оператор -> поставщики данных, обработки и доставки; межрегиональный заказчик отдельно покрывает согласованный ENV-gap. Ценностная линия: оператор -> агроном/эколог/штаб/диспетчер -> проверенное решение -> региональный результат -> общественные получатели. Получатель эффекта может не платить.'),
        p('Покрытие_i = CASH_i/OPEX_i; gap_i=max(OPEX_i-CASH_i,0). Формулы и Шепли включены в finance.csv рядом с исходными полями.', size=9)))

    sensitivity_rows = [[n(row['phi'],2), n(row['grand_cost_mrub']), *[n(100*row['shares'][player['lot_id']],1)+' %' for player in coalition['players']], 'PASS' if row['core_ok'] else 'FAIL'] for row in coalition['sensitivity']]
    note.append(page('9. Межрегиональный консорциум и вектор Шепли',
        p(f"Допущение phi={n(coalition['phi'],2)}: доля общей платформы. Поодиночке {n(coalition['standalone_total_mrub'])}; союз {n(coalition['grand_cost_mrub'])}; экономия {n(coalition['cooperation_savings_mrub'])} млн руб. ({n(100*coalition['cooperation_savings_share'],1)} %)."),
        table(['Регион / лот','Поодиночке','Шепли','Доля','Пропорц.','Поровну'], coalition_rows, widths=[1.5,1,1,1,1,1], size=8.1),
        p(f"Эффективность: сумма долей равна стоимости союза с ошибкой {n(coalition['efficiency_error_mrub'])}. Ядро: {'PASS' if coalition['core']['ok'] else 'FAIL'}, проверено {coalition['core']['checked']} собственных коалиций. Ни одна группа не платит больше стоимости отделения."),
        table(['phi','Стоимость союза', *[row['lot_id'] for row in coalition['players']], 'Ядро'], sensitivity_rows,
              widths=[.55,1,*([.75]*len(coalition['players'])),.65], size=7.5),
        p('Практическим упрощением может быть пропорциональное правило, но теоретическое распределение и проверка устойчивости сохранены. Основание: Shapley E14 и Gillies E14.', size=9)))

    equity_rows = [[row['territory']+' / '+row['lot_id'],row['count'],n(100*row['share'],1)+' %'] for row in equity['regions']]
    note.append(page('10. Справедливость и режимы партнёрства',
        table(['Регион / лот','В 143 STRESS','Частота'], equity_rows, size=8.3),
        p('В 116 вариантах представлены четыре региона, в 27 - три. Состав физически не обеспечивает всех семерых. Поэтому справедливость задают доли Шепли, доступ невключённых регионов к платформе/данным/методикам и приоритет следующей волны.'),
        h('Арктика и TRANS'),
        p('ARCTIC не встречается: исходные C0 460, OPEX 140, t_rep 0,55; минимум C0 портфеля с ним 1225 выше STRESS. Нужен отдельный федеральный механизм. TRANS входит во все 143: без него минимум C0 1184,4 выше лимита.'),
        h('A/B/C - проектное отображение O2, не юридическая квалификация'),
        p('A / тип 1: заказчик финансирует и контролирует общественное ядро, подрядчик эксплуатирует; ENV и FLOOD выбраны A из-за критичности и слабого массового рынка. B / тип 2-3: софинансирование и ограниченный базовый слой. C / тип 4: частный полный цикл и клубный доступ; AGRI и TRANS выбраны C из-за индивидуального спроса. Зрелость, пул поставщиков, опыт, рынок и критичность проверяются по каждому лоту (O1).', size=9)))

    note.append(page('11. Критические сдвиги и смена поставщика',
        table(['Событие','Критический сдвиг','Параметр','Порог'], risk_rows, widths=[2.5,.9,1,1], size=8.1),
        bars([row['rule_id'] for row in tornado],[abs(100*row['critical_change_fraction']) for row in tornado],
             'Абсолютная величина критического сдвига, %. Наиболее близкая граница - C0 в STRESS.'),
        p('Узкое место - удорожание запуска в STRESS. Меры: контроль зрелости сметы, этапная приёмка, выводимый резерв и заранее оговорённый опцион. Для денежных поступлений запас до формального порога существенно больше; адресные lot gaps всё равно раскрываются.'),
        h('Триггеры и готовность переноса'),
        p('Истечение договора; нарушение SLA после срока исправления; цена выше договорного порога; технологическая несовместимость; отказ передать данные. Заранее нужны форматы, открытые API, права на историю, документация, контрольный набор и резервная схема. Процесс: акт -> исправление -> конкурс -> экспорт -> параллельная проверка -> решение приёмщика -> переключение. O5.'),
        p('Второй обработчик может зависеть от того же первичного источника; без пригодного резерва неподдерживаемая часть сервиса приостанавливается.', size=9)))

    roadmap_rows = [[f"{row['id']} / {row['start_month']}-{row['end_month']}",row['result'],row['owner'],row['acceptance']] for row in config['roadmap']]
    note.append(page('12. Реализация, проверка и источники',
        table(['Этап','Результат','Владелец','Приёмка'], roadmap_rows, widths=[.7,1.8,1.3,2], size=7.2),
        p('Нет прав, полного финансирования, сезона, события, лаборатории, рейсов или контрольной выборки - этап переносится; отсутствие данных не считается нулевым эффектом. Каждый пилот выпускает регламент, контрольный набор и журнал изменений; следующая площадка повторяет местную приёмку.'),
        h('Ключевые внешние источники и границы'),
        link('E8 / HM Treasury: надбавка на оптимизм; не обязательная норма заказчика', 'https://www.gov.uk/government/publications/green-book-supplementary-guidance-optimism-bias'),
        link('E9 / GAO-26-108556: портфель крупных проектов NASA; не калибровка кейса', 'https://www.gao.gov/products/gao-26-108556'),
        link('E10 / Charnes & Cooper: вероятностные ограничения; нормальность - A17-A19', 'https://pubsonline.informs.org/doi/10.1287/mnsc.6.1.73'),
        link('E13 / de Neufville & Scholtes: гибкость проектируется заранее', 'https://mitpress.mit.edu/9780262016230/flexibility-in-engineering-design/'),
        link('E15 / МЧС: масштаб пожаров 2025; контекст, не коэффициент модели', 'https://en.mchs.gov.ru/for-mass-media/novosti/5522631'),
        p('Полный реестр E1-E16, O1-O5, страницы и ограничения: docs/sources.md. Воспроизведение: python -X utf8 -B scripts/reproduce.py config/assumptions.json --advanced --output out/advanced.json; сборка: scripts/build_submission.py.', size=8.3)))

    summary = [page('STRESS: три состояния и договорное действие',
        p(scope, size=13),
        table(['Состояние','C0','VPUB','KCASH','Gap','P STRESS','Статус'], [[row[0],row[2],row[3],row[4],row[5],row[7],row[8]] for row in triad_rows],
              widths=[1.5,.8,.8,.8,.7,.8,.7], size=8.2),
        p('Опцион TRANS A->B активируется подтверждённым лимитом ниже 1 200 млн руб.; капитал сохраняется, показатели заново считает канонический адаптер. Текущая рекомендация не меняется автоматически.'),
        table(['Стресс-ответ','Число'], [[classifier['labels'][key],classifier['counts'][key]] for key in ('0','1','3')], size=8.3),
        p(f"При sigma=5 %, confidence=90 % надёжны STRESS {reliability['STRESS']['reliable']} вариантов; максимум {n(reliability['STRESS']['max_vpub_mrub_per_year'])} VPUB/год. Ближайшая граница текущего состава: C0 STRESS {n(100*tornado[0]['critical_change_fraction'],2)} %."),
        p('Решение принимает '+stress['owner']+'. До обязательств подтвердить полный C0, эксплуатацию, адресный ENV-gap, права и местную приёмку. Денежные потоки и VPUB остаются раздельными.'),
        p(BOUNDARY, size=8.4))]

    slides = []
    slides.append(page('Инфраструктура с договорной гибкостью', p(scope,size=27),
        p(f"C0 {n(totals['c0_mrub'])} · OPEX {n(totals['opex_mrub_per_year'])}/год · VPUB {n(totals['vpub_mrub_per_year'])}/год",size=22),
        p('Сохраняем рекомендацию; добавляем заранее оговорённый стресс-опцион и проверяем его на всех 5 670 вариантах.',size=20)))
    slides.append(page('Потребность заканчивается решением пользователя', table(['Лот','Пользователь -> решение','Источник проверки'],need_rows, widths=[.6,1.1,2,1.7],size=14),
        p('FLOOD: ущерб 2021 года 7,5 млрд руб.; F1 оползней 60,7 % означает обязательный human-in-the-loop. Внешние числа - контекст, не вход модели.',size=17)))
    slides.append(page('Две линии результата', table(['Лот','Прямая','Косвенная','Опцион','Наследование'],tev_rows,widths=[.6,1.1,1.5,1,1.5],size=15),
        p('Денежный поток и полная экономическая ценность не объединяются: получатель эффекта может не платить. O3.',size=19)))
    slides.append(page('Надбавка на оптимизм', table(['Надбавка','BASE число','BASE max','STRESS число','STRESS max'],ladder_rows,size=16),
        p('1300/1180 - 1 = 10,17 %. При 20 % не остаётся ни одного BASE-варианта. HM Treasury E8; GAO E9.',size=18)))
    slides.append(page('Опцион: польза, безопасность, действие', table(['Состояние','Режимы','C0','VPUB','Gap','P STRESS','Статус'],[[r[0],r[1],r[2],r[3],r[5],r[7],r[8]] for r in triad_rows],widths=[1.2,1.5,.7,.8,.7,.8,.7],size=14),
        p('143 уже допустимы · 86 чинятся режимами · 802 не пересобираются. TRANS A->B сохраняет капитал.',size=20)))
    slides.append(page('Вероятность и выводимый резерв', p('Var(C0)=sigma^2 C^2 [(1-rho)H+rho]\nH=sum(c_i/C)^2; effective lots=1/H',size=21),
        table(['rho','Резерв, млн руб.','Доля'],rho_rows,size=17),
        p(f"При sigma=5 %, confidence=90 %: STRESS {reliability['STRESS']['reliable']} надёжных; цена надёжности {n(reliability['price_of_reliability_mrub_per_year'])} VPUB/год.",size=18)))
    slides.append(page('Связывает бюджет', table(['Эксперимент','Delta BASE','Delta STRESS'],shadow_rows,size=12),
        p('C0 +10 в STRESS: +39,6 VPUB/год. Третья технологическая группа: -220,4. Диверсификацию обеспечиваем интерфейсами и правами.',size=14)))
    slides.append(page('Кривая бюджетной эффективности', line(eff_points,'F(B): максимум VPUB при лимите B. Зона 1180-1300 выделена.',x_label='C0, млн руб.',band=[1180,1300],markers=[1180,1300],height=260),
        p('1123,5 -> 1020,4 · 1180 -> 1370,4 · 1300 -> 1766,0 · насыщение 1312,5 -> 1820,0',size=17)))
    slides.append(page('Пространство решений схлопывается', line(survival_points,'Допустимые портфели по глубине сокращения BASE.',x_label='Сокращение, %',markers=[9.2,13.6],height=250),
        p('1031 -> 858 -> 623 -> 327 -> 145 -> 115 -> 28 -> 0. Бюджет -9,2 %; максимум VPUB -22,4 %.',size=18)))
    slides.append(page('Честные деньги и устойчивый консорциум', table(['Лот','OPEX','CASH','Покрытие','Lot gap','Шепли'],
        [[row['lot_id'],n(row['opex_mrub_per_year']),n(row['cash_mrub_per_year']),n(100*row['lot_coverage_ratio'],1)+' %',n(row['lot_funding_gap']),n(next(x['shapley_mrub'] for x in coalition['players'] if x['lot_id']==row['lot_id']))] for row in finance['rows']],size=15),
        p(f"Союз {n(coalition['grand_cost_mrub'])} против {n(coalition['standalone_total_mrub'])} поодиночке: экономия {n(100*coalition['cooperation_savings_share'],1)} %. Ядро PASS: {coalition['core']['checked']} проверок.",size=18)))
    slides.append(page('Справедливость и риск', table(['Регион','Частота STRESS'],[[r['lot_id'],n(100*r['share'],1)+' %'] for r in equity['regions']],size=14),
        p('Критические сдвиги текущего состава: C0 STRESS +2,54 %; t_rep -11,89 %; C0 BASE +12,96 %; OPEX +15,76 %; VPUB -19,29 %; денежные поступления -54,54 %. Узкое место - запуск в STRESS.',size=17),
        p('ARCTIC: 0 из 143 — отдельный механизм. TRANS: 143 из 143. Справедливость: Шепли, доступ, следующая волна.',size=14)))
    slides.append(page('Что подписать и как проверить', p('1. Триггер и TRANS A->B до обязательств.\n2. Полный C0, эксплуатация и адресный ENV-gap.\n3. Форматы, открытые API, права на историю, документация и резерв.\n4. Baseline, контрольный набор, независимая приёмка.\n5. Регламент и приоритет следующей площадки.',size=22),
        p('Демонстрация: изменить A16-A22 -> увидеть три колонки -> исполнить опцион -> проверить торнадо, кривые, Шепли и скачать этот же bundle.',size=19),
        p('Источники и границы: docs/sources.md. Все числа воспроизводятся scripts/reproduce.py --advanced.',size=16)))
    return {'note': note, 'stress': summary, 'slides': slides}
