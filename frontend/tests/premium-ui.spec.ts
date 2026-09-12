/**
 * Decision-support UI regression for the six primary screens: overview, search,
 * comparison, stress, builder. Every expected number is read from the live API in the
 * same run, so the test never hardcodes case values.
 *
 * Run against a serving build:  npm --prefix frontend run test:browser
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test'

type Json = Record<string, any>

const M0 = { vpub: 0.3, c0: 0.15, opex: 0.1, kcash: 0.1, t_rep: 0.05, readiness: 0.1, resilience: 0.15, scale: 0.05 }

async function decision(request: APIRequestContext, weights = M0, scenario = 'BASE', limit = 10): Promise<Json> {
  const kase = await (await request.get('/api/case')).json()
  const method = await (await request.get('/api/decision-method')).json()
  const response = await request.post('/api/decision/recompute', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      format_version: 'kosmos-decision/1', expected_population_id: null,
      request: {
        format_version: 'kosmos-search/1', case_id: kase.case_id, case_version: kase.case_version,
        source_hashes: kase.source_hashes, modes: 'A/B/C', method_version: method.method_version,
        scenario, weights, limit, baseline: null,
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

const ru = (value: number, digits = 3) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value).replace(/ | /g, ' ')
const ranking = (page: Page) => page.getByRole('region', { name: 'Лидеры поиска' }).locator('tbody tr')
const view = (page: Page) => page.locator('#view')

/** The search runs the whole population on first load; give it room. */
async function ready(page: Page, leaderId: string) {
  await page.goto('/#/search/shortlist')
  await expect(ranking(page).first()).toHaveAttribute('data-portfolio-id', leaderId, { timeout: 120_000 })
}

async function open(page: Page, id: string) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: id, exact: true }).click()
}

async function setRows(page: Page, rows: [string, string][]) {
  await open(page, 'Конструктор')
  await page.getByRole('button', { name: 'Сбросить всё', exact: true }).click()
  for (let index = 0; index < rows.length; index++) {
    await page.getByLabel(`Лот ${index + 1}`, { exact: true }).selectOption(rows[index][0])
    await page.getByLabel(`Режим ${index + 1}`, { exact: true }).selectOption(rows[index][1])
  }
}

test.describe('Обзор отвечает на вопрос экрана', () => {
  test('рекомендация, показатели и вердикт STRESS приходят из расчёта', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await ready(page, leader.portfolio_id)
    await open(page, 'Обзор')

    for (const row of leader.selection) await expect(page.locator('.lot-strip')).toContainText(row.lot_id)
    await expect(page.locator('.decision-card .object-meta')).toContainText(ru(data.search.ranked_count))
    await expect(page.locator('.decision-figures')).toContainText(ru(leader.metrics.c0_mrub, 1))
    await expect(page.locator('.decision-figures')).toContainText(ru(leader.metrics.vpub_mrub_per_year, 1))

    const stress = leader.scenarios.STRESS
    const verdict = page.locator('.verdict')
    await expect(verdict).toHaveAttribute('data-tone', stress.status === 'PASS' ? 'pass' : 'fail')
    await expect(verdict).toContainText(stress.status === 'PASS' ? 'Портфель не меняется' : 'не проходит STRESS')
    await expect(verdict).toContainText(ru(stress.c0_margin))
    await expect(verdict).toContainText(ru(data.search.population.scenarios.STRESS.feasible))

    // The claim stays scoped, never "objectively optimal".
    await expect(view(page)).not.toContainText('объективно оптимальный')
  })

  test('путь решения показывает реальные счётчики и раскрывает причины исключения', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Обзор')

    const population = data.search.population
    const path = page.locator('.path')
    await expect(path).toContainText(ru(population.total))
    await expect(path).toContainText(ru(population.scenarios.BASE.excluded))
    await expect(path).toContainText(ru(population.scenarios.BASE.feasible))

    const toggle = page.getByRole('button', { name: 'Причины исключения' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    const panel = page.locator('.exclusions')
    await expect(panel).toContainText('доли пересекаются')
    for (const reason of population.scenarios.BASE.exclusion_reasons) await expect(panel).toContainText(ru(reason.count))
    // The overlapping counts must not be presented as a partition of the excluded set.
    const sum = population.scenarios.BASE.exclusion_reasons.reduce((total: number, row: Json) => total + row.count, 0)
    expect(sum).toBeGreaterThan(population.scenarios.BASE.excluded)
  })

  test('каждый этап пути ведёт в работающий раздел', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Обзор')
    await page.locator('.path').getByRole('button', { name: 'Почему выбрана' }).click()
    await expect(page.locator('.why-pair')).toBeVisible({ timeout: 60_000 })
    await expect(page).toHaveURL(/#\/search\/why$/)
  })
})

test.describe('Поиск и выбор', () => {
  test('шортлист, график и карточка решения связаны; наведение ничего не применяет', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    const second = data.search.ranking[1]
    await ready(page, leader.portfolio_id)

    await expect(view(page)).toContainText(`${ru(data.search.population.scenarios.BASE.feasible)} допустимых`)
    const row = ranking(page).nth(1)
    await row.hover()
    await expect(page.locator('.readout')).toContainText(ru(second.metrics.c0_mrub, 1))
    await expect(page.locator('.readout .object-role')).toContainText('Просматриваемый вариант')

    // Keyboard focus drives the same link, and the numbers are not tooltip-only.
    await row.getByRole('button', { name: 'В конструктор' }).focus()
    await expect(page.locator('.readout')).toContainText(ru(second.metrics.c0_mrub, 1))

    // Hover never changes the manual portfolio.
    await open(page, 'Конструктор')
    await expect(page.getByLabel('Название текущего варианта')).toHaveValue('Мой портфель')
  })

  test('2D-проекция подписана как две оси из восьми и не рисует границу Парето', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    const plot = page.locator('.plot')
    await expect(plot).toContainText('Две оси из восьми критериев')
    await expect(plot).toContainText('Линия Парето не строится')
    await expect(plot.locator('.plot-cap')).toHaveCount(2)
    await page.getByRole('button', { name: 'Приблизить шортлист' }).click()
    await plot.getByRole('button', { name: 'О графике' }).click()
    await expect(plot).toContainText('Оси приближены')
  })

  test('строка шортлиста добавляется в сравнение и удаляется из него', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Сравнение')
    const before = await page.locator('.matrix thead th').count()
    await open(page, 'Поиск')
    await ranking(page).nth(2).getByRole('button', { name: 'В сравнение' }).click()
    await open(page, 'Сравнение')
    await expect(page.locator('.matrix thead th')).toHaveCount(before + 1)
    await page.locator('.matrix-actions').getByRole('button', { name: 'Убрать из сравнения' }).first().click()
    await expect(page.locator('.matrix thead th')).toHaveCount(before)
  })

  test('схема портфеля управляется клавиатурой и подписана как условная', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await ready(page, leader.portfolio_id)
    await page.goto('/#/search/why')
    const map = page.locator('.map')
    await expect(map).toBeVisible({ timeout: 60_000 })
    await expect(map).toContainText('не географическая карта')
    await map.getByRole('button', { name: 'Что показывает схема' }).click()
    await expect(map).toContainText('не орбиты и не число спутников')
    await expect(map.locator('.map-node')).toHaveCount(leader.selection.length)
    await map.locator('.map-node').nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(map.locator('.map-readout .object-title')).toContainText(leader.selection[1].lot_id)
  })

  test('расчёт содержит веса, чувствительность и каталог', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await page.goto('/#/search/method')
    await expect(page.locator('.method-page')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-sensitivity]')).toHaveCount(data.sensitivity.runs.length)
    await expect(view(page)).toContainText('локальная проверка двух весов')
    await expect(view(page)).toContainText('При равенстве неокруглённого score')
    await page.getByText('Восемь лотов: исходные значения', { exact: false }).click()
    await expect(page.locator('#catalog-lots tbody tr')).toHaveCount(8)
  })
})

test.describe('Приоритеты', () => {
  test('изменение веса меняет применённые доли и помечает изменённый профиль', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await expect(page.locator('.preferences .chip-draft')).toHaveCount(0)

    const heavy = await decision(request, { ...M0, vpub: 0.9 })
    await page.getByLabel('Вес vpub', { exact: true }).fill('.9')
    await expect(ranking(page).first()).toHaveAttribute('data-portfolio-id', heavy.search.ranking[0].portfolio_id, { timeout: 120_000 })
    await expect(page.locator('.preferences .chip-draft')).toContainText('Веса изменены')
    const share = await page.getByTestId('applied-vpub').getAttribute('data-value')
    expect(Math.abs(Number(share) - heavy.search.weights.applied.vpub)).toBeLessThan(1e-9)
  })

  test('сброс настроек поиска возвращает объявленные веса и шортлист', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await page.getByLabel('Вес vpub', { exact: true }).fill('.9')
    await page.locator('.preferences summary').click()
    await page.getByLabel('Размер шортлиста', { exact: true }).selectOption('25')
    await page.getByRole('button', { name: 'Сбросить настройки поиска', exact: true }).click()
    await expect(ranking(page).first()).toHaveAttribute('data-portfolio-id', data.search.ranking[0].portfolio_id, { timeout: 120_000 })
    await expect(page.getByLabel('Вес vpub', { exact: true })).toHaveValue('0.3')
    await expect(page.getByLabel('Размер шортлиста', { exact: true })).toHaveValue('10')
  })

  test('пустые веса показывают ошибку и скрывают рейтинг, а не старые числа', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    for (const key of Object.keys(M0)) await page.getByLabel(`Вес ${key}`, { exact: true }).fill('0')
    await expect(page.locator('#view').getByRole('alert')).toContainText('больше нуля')
    await expect(ranking(page)).toHaveCount(0)
  })
})

test.describe('Сравнение: цена компромисса впереди таблицы', () => {
  test('карточки компромисса и матрица повторяют серверные дельты', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Сравнение')

    const cards = page.getByTestId('tradeoff-cards')
    await expect(cards).toBeVisible()
    for (const strategyId of ['max_vpub', 'min_c0']) {
      const alternative = data.alternatives.find((item: Json) => item.strategy_id === strategyId)
      await expect(page.locator('.matrix')).toContainText(ru(alternative.candidate.metrics.c0_mrub, 3))
      const delta = alternative.delta_to_current_leader.vpub_mrub_per_year
      await expect(page.locator('.matrix')).toContainText(`${delta > 0 ? '+' : ''}${ru(delta)}`)
    }
    await expect(page.locator('.matrix-verdicts')).toContainText('Выигрывает')
    await expect(page.locator('.matrix-verdicts')).toContainText('Уступает')
  })

  test('большая таблица — второй уровень', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Сравнение')
    const money = page.locator('.matrix-band', { hasText: 'Денежные потоки' })
    await expect(money).toBeHidden()
    await page.getByRole('button', { name: 'Все показатели', exact: true }).click()
    await expect(money).toBeVisible()
  })
})

test.describe('STRESS как управленческое условие', () => {
  test('рекомендация: ответ сразу, стоимость не сокращается до нового лимита', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await ready(page, leader.portfolio_id)
    await open(page, 'Стресс')

    const verdict = page.locator('.verdict')
    await expect(verdict).toContainText(ru(leader.scenarios.BASE.c0_margin))
    await expect(verdict).toContainText(ru(leader.scenarios.STRESS.c0_margin))
    await expect(page.locator('.budget-axis')).toBeVisible()
    await page.getByRole('button', { name: 'Что меняет сценарий' }).click()
    await expect(view(page)).toContainText('сценарий меняет только лимит стартовых затрат')
    await expect(view(page)).toContainText('не удешевляет портфель')
  })

  test('мой состав: точное нарушение, кандидаты, предпросмотр, применение и возврат', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await setRows(page, [['FIRE', 'A'], ['FLOOD', 'A'], ['INFRA', 'B'], ['ENV', 'A']])
    await page.goto('/#/stress/own')
    await expect(page.getByTestId('stress-summary-STRESS')).toContainText('FAIL', { timeout: 60_000 })

    const verdict = page.locator('.verdict[data-tone="fail"]')
    await expect(verdict).toContainText('Состав не проходит STRESS')
    await expect(verdict).toContainText('нарушение')
    await page.getByRole('button', { name: 'Почему стоимость не меняется' }).click()
    await expect(view(page)).toContainText('не две стадии ранжирования')
    await expect(view(page)).toContainText('не содержит переходных затрат')

    const candidates = page.getByRole('region', { name: 'Допустимые в STRESS кандидаты' }).locator('tbody tr')
    expect(await candidates.count()).toBeGreaterThan(0)
    await candidates.first().getByRole('button', { name: 'Предпросмотр' }).click()
    const preview = page.locator('.stress-preview')
    await expect(preview).toContainText('текущий состав не изменён')
    await expect(preview).toContainText('Сейчас')
    await expect(preview).toContainText('В предпросмотре')

    // Applying opens the composition in the builder, where the change can be undone.
    await preview.getByRole('button', { name: 'Применить состав' }).click()
    await expect(page.locator('.view-title')).toHaveText('Конструктор портфеля')
    await expect(page.getByLabel('Название текущего варианта')).toHaveValue(/STRESS-допустимый/)
    await page.getByRole('button', { name: 'Отменить изменение', exact: true }).click()
    await expect(page.getByLabel('Название текущего варианта')).not.toHaveValue(/STRESS-допустимый/)
  })

  test('пустой конструктор: раздел просит состав и предлагает открыть рекомендацию', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Конструктор')
    await page.getByRole('button', { name: 'Сбросить всё', exact: true }).click()
    await page.goto('/#/stress/own')
    await expect(view(page)).toContainText('Соберите четыре лота')
    await page.getByRole('button', { name: 'Открыть рекомендуемый состав', exact: true }).click()
    await expect(page.getByTestId('metric-c0_mrub')).toHaveText(ru(data.search.ranking[0].metrics.c0_mrub, 1))
  })
})

test.describe('Границы формулировок', () => {
  test('нет запрещённых утверждений о прибыли, окупаемости и Парето', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    const text = await page.locator('body').innerText()
    expect(text).not.toContain('Парето-фронт')
    expect(text).not.toContain('Pareto frontier')
    expect(text).not.toContain('объективно оптимальный портфель')
    await open(page, 'Обзор')
    await page.getByRole('button', { name: 'Что такое Денежное покрытие' }).first().click()
    await expect(page.locator('.tip-bubble')).toContainText('не окупаемость')
    await open(page, 'Сравнение')
    await page.getByRole('button', { name: 'Все показатели', exact: true }).click()
    expect((await page.locator('.matrix').innerText()).toLowerCase()).toContain('vpub отдельно от cash')
  })
})

test.describe('Доступность и адаптивность', () => {
  for (const [name, width, height] of [['desktop', 1440, 900], ['laptop', 1366, 768], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
    test(`${name} ${width}×${height}: нет горизонтальной прокрутки страницы`, async ({ page, request }) => {
      const data = await decision(request)
      await page.setViewportSize({ width, height })
      await ready(page, data.search.ranking[0].portfolio_id)
      for (const id of ['Обзор', 'Поиск', 'Стресс', 'Конструктор', 'Сравнение', 'Реализация']) {
        await open(page, id)
        await expect(page.locator('.view-title')).toBeVisible()
        const bounds = await page.evaluate(() => ({ w: window.innerWidth, s: document.documentElement.scrollWidth }))
        expect(bounds.s, `${name}/${id} horizontal overflow`).toBeLessThanOrEqual(bounds.w)
      }
    })
  }

  test('статусы читаются текстом, а не только цветом', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Сравнение')
    await page.getByRole('button', { name: 'Все показатели', exact: true }).click()
    await expect(page.locator('.matrix .badge').first()).not.toHaveText('')
    await expect(page.locator('.matrix')).toContainText('выполнено')
    await expect(page.locator('.matrix')).toContainText('PASS')
  })

  test('при reduced motion значения остаются на месте', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await ready(page, leader.portfolio_id)
    await open(page, 'Обзор')
    await expect(page.locator('.decision-figures')).toContainText(ru(leader.metrics.c0_mrub, 1))
    const duration = await page.locator('.path-bar i').first().evaluate(node => getComputedStyle(node).transitionDuration)
    expect(['0s', '0.001s']).toContain(duration)
  })

  test('видимый фокус на интерактивных элементах', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    const button = page.getByRole('button', { name: 'Веса M0', exact: true })
    await button.focus()
    const outline = await button.evaluate(node => getComputedStyle(node).outlineWidth)
    expect(parseFloat(outline)).toBeGreaterThan(0)
  })
})

test.describe('Целостность продукта', () => {
  test('нет внешних запросов и ошибок страницы', async ({ page, request }) => {
    const external: string[] = []
    const errors: string[] = []
    page.on('request', item => { if (!/^(http:\/\/127\.0\.0\.1|http:\/\/localhost|blob:|data:)/.test(item.url())) external.push(item.url()) })
    page.on('pageerror', error => errors.push(String(error)))
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Реализация')
    await expect(page.locator('.delivery-hero')).toBeVisible({ timeout: 120_000 })
    expect(external).toEqual([])
    expect(errors).toEqual([])
  })

  test('все прежние действия рабочей области на месте', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await page.locator('.preferences summary').click()
    for (const name of ['Веса M0', 'Равные веса', 'Скачать JSON выбора', 'Импорт выбора']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
    }
    await open(page, 'Конструктор')
    for (const name of ['Скачать JSON', 'Импорт JSON', 'Сбросить всё', 'Отменить изменение']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
    }
    await expect(page.locator('.slot')).toHaveCount(4)
    await open(page, 'Сравнение')
    await page.getByRole('button', { name: 'Сохранённые составы', exact: true }).click()
    await expect(page.locator('.empty')).toBeVisible()
  })

  test('сохранённые материалы отделены от текущего расчёта', async ({ page, request }) => {
    const data = await decision(request)
    await ready(page, data.search.ranking[0].portfolio_id)
    await open(page, 'Реализация')
    await expect(view(page)).toContainText('сохранённый выпуск', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Материалы', exact: true }).click()
    await expect(view(page)).toContainText('Ручной портфель и новые веса не меняют выводы этих файлов')
  })
})
