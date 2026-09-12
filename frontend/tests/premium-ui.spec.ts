/**
 * Decision-support UI regression for the NEXT-1 surfaces: first screen, evidence,
 * comparison, preferences and the STRESS explanation. Every expected number is read
 * from the live API in the same run, so the test never hardcodes case values.
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

const ru = (value: number, digits = 3) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value).replace(/ | /g, ' ')
const ranking = (page: Page) => page.getByRole('region', { name: 'Лидеры поиска' }).locator('tbody tr')
const atlas = (page: Page) => page.locator('#overview')

async function ready(page: Page, leaderId: string) {
  await expect(ranking(page).first()).toHaveAttribute('data-portfolio-id', leaderId, { timeout: 120_000 })
}

async function boot(page: Page, leaderId: string) {
  await page.goto('/')
  await ready(page, leaderId)
}

async function setRows(page: Page, rows: [string, string][]) {
  await page.getByRole('button', { name: 'Сбросить всё', exact: true }).click()
  for (let index = 0; index < rows.length; index++) {
    await page.getByLabel(`Лот ${index + 1}`, { exact: true }).selectOption(rows[index][0])
    await page.getByLabel(`Режим ${index + 1}`, { exact: true }).selectOption(rows[index][1])
  }
}

test.describe('Первый экран несёт решение', () => {
  test('счётчики воронки, состав и вердикт STRESS приходят из расчёта', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await boot(page, leader.portfolio_id)

    const population = data.search.population
    await expect(atlas(page)).toContainText(ru(population.total))
    await expect(atlas(page)).toContainText(ru(population.scenarios.BASE.excluded))
    await expect(atlas(page)).toContainText(ru(population.scenarios.BASE.feasible))
    await expect(atlas(page)).toContainText(ru(population.scenarios.STRESS.feasible))

    for (const row of leader.selection) await expect(atlas(page).locator('.atlas-lots')).toContainText(row.lot_id)
    await expect(atlas(page)).toContainText(ru(leader.metrics.c0_mrub))
    await expect(atlas(page)).toContainText(ru(leader.metrics.vpub_mrub_per_year))

    const stress = leader.scenarios.STRESS
    await expect(atlas(page).locator('.atlas-stress')).toContainText(stress.status === 'PASS' ? 'Состав сохраняется' : 'не проходит STRESS')
    if (stress.status === 'PASS') await expect(atlas(page).locator('.atlas-stress')).toContainText(ru(stress.c0_margin))

    // The claim is scoped, never "objectively optimal".
    await expect(atlas(page)).toContainText('не единственный объективно оптимальный')
  })

  test('причины исключения раскрываются и предупреждают о пересечении', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    const toggle = atlas(page).getByRole('button', { name: 'Причины исключения' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    const panel = page.locator('.exclusions')
    await expect(panel).toContainText('доли пересекаются')
    await expect(panel).toContainText('не образует взаимно исключающих сегментов')
    for (const reason of data.search.population.scenarios.BASE.exclusion_reasons) {
      await expect(panel).toContainText(ru(reason.count))
    }
    // The overlapping counts must not be presented as a partition of the excluded set.
    const sum = data.search.population.scenarios.BASE.exclusion_reasons.reduce((total: number, row: Json) => total + row.count, 0)
    expect(sum).toBeGreaterThan(data.search.population.scenarios.BASE.excluded)
  })
})

test.describe('Почему этот портфель', () => {
  test('матрица сравнивает минимум с двумя альтернативами и повторяет серверные дельты', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await boot(page, leader.portfolio_id)

    const headers = page.locator('.matrix thead th')
    expect(await headers.count()).toBeGreaterThanOrEqual(4) // corner + leader + two alternatives

    for (const strategyId of ['max_vpub', 'min_c0']) {
      const alternative = data.alternatives.find((item: Json) => item.strategy_id === strategyId)
      await expect(page.locator('.matrix')).toContainText(ru(alternative.candidate.metrics.c0_mrub))
      await expect(page.locator('.matrix')).toContainText(ru(alternative.candidate.metrics.vpub_mrub_per_year))
      // Server-computed delta, shown with the app's six-digit convention.
      const delta = alternative.delta_to_current_leader.vpub_mrub_per_year
      await expect(page.locator('.matrix')).toContainText(`${delta > 0 ? '+' : ''}${ru(delta, 6)}`)
    }
    await expect(page.locator('.matrix-verdicts')).toContainText('Выигрывает')
    await expect(page.locator('.matrix-verdicts')).toContainText('Уступает')
  })

  test('2D-проекция подписана как две оси из восьми и не рисует границу Парето', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    const plot = page.locator('.plot')
    await expect(plot).toContainText('два критерия из восьми')
    await expect(plot).toContainText('Линия Парето не строится')
    await expect(plot.locator('.plot-cap')).toHaveCount(2)
    await page.getByRole('button', { name: 'Приблизить шортлист' }).click()
    await expect(plot).toContainText('Оси приближены')
    await page.getByRole('button', { name: 'Весь диапазон допустимых' }).click()
    await expect(plot).toContainText('Прямоугольник — диапазон значений')
  })

  test('строка шортлиста, график и readout связаны; наведение ничего не применяет', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    const second = data.search.ranking[1]
    await boot(page, leader.portfolio_id)

    const nameField = page.getByLabel('Название текущего варианта')
    const before = await nameField.inputValue()
    const row = ranking(page).nth(1)
    await row.hover()
    await expect(page.locator('.readout')).toContainText(ru(second.metrics.c0_mrub))
    await expect(page.locator('.readout-role')).toContainText('Просматриваемый')
    expect(await nameField.inputValue()).toBe(before) // hover never applies a portfolio

    // Keyboard focus drives the same link, and the numbers are not tooltip-only.
    await row.getByRole('button', { name: 'В конструктор' }).focus()
    await expect(page.locator('.readout')).toContainText(ru(second.metrics.c0_mrub))
  })

  test('добавление варианта шортлиста в матрицу и удаление из неё', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    const columnsBefore = await page.locator('.matrix thead th').count()
    await ranking(page).nth(2).getByRole('button', { name: 'В сравнение' }).click()
    await expect(page.locator('.matrix thead th')).toHaveCount(columnsBefore + 1)
    await page.locator('.matrix-actions').getByRole('button', { name: 'Убрать из сравнения' }).first().click()
    await expect(page.locator('.matrix thead th')).toHaveCount(columnsBefore)
  })

  test('схема портфеля управляется клавиатурой и подписана как условная', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await boot(page, leader.portfolio_id)
    const map = page.locator('.map')
    await expect(map).toContainText('не географическая карта')
    await expect(map).toContainText('не орбиты и не число спутников')
    const nodes = map.locator('.map-node')
    await expect(nodes).toHaveCount(leader.selection.length)
    const second = leader.selection[1].lot_id
    await map.locator('.map-node').nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(map.locator('.map-readout h4')).toContainText(second)
  })
})

test.describe('Предпочтения', () => {
  test('изменение веса меняет применённые доли и помечает исследовательский режим', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await expect(page.locator('.preference-mode')).toContainText('Объявленный профиль')

    const heavy = await decision(request, { ...M0, vpub: 0.9 })
    await page.getByLabel('Вес vpub', { exact: true }).fill('.9')
    await ready(page, heavy.search.ranking[0].portfolio_id)
    await expect(page.locator('.preference-mode')).toContainText('Исследовательский режим')
    const share = await page.getByTestId('applied-vpub').getAttribute('data-value')
    expect(Math.abs(Number(share) - heavy.search.weights.applied.vpub)).toBeLessThan(1e-9)
    await expect(page.locator('.preference-effect')).toContainText('Лидер при этом векторе')
  })

  test('сброс конфигурации возвращает объявленные веса, сценарий и шортлист', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await page.getByLabel('Вес vpub', { exact: true }).fill('.9')
    await page.getByLabel('Сценарий поиска', { exact: true }).selectOption('STRESS')
    await page.getByLabel('Размер шортлиста', { exact: true }).selectOption('25')
    await page.getByRole('button', { name: 'Сбросить конфигурацию поиска', exact: true }).click()
    await ready(page, data.search.ranking[0].portfolio_id)
    await expect(page.getByLabel('Вес vpub', { exact: true })).toHaveValue('0.3')
    await expect(page.getByLabel('Сценарий поиска', { exact: true })).toHaveValue('BASE')
    await expect(page.getByLabel('Размер шортлиста', { exact: true })).toHaveValue('10')
    await expect(page.locator('.preference-mode')).toContainText('Объявленный профиль')
  })

  test('пустой вес показывает ошибку и скрывает рейтинг, а не старые числа', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    for (const key of Object.keys(M0)) await page.getByLabel(`Вес ${key}`, { exact: true }).fill('0')
    await expect(page.locator('#decision').getByRole('alert')).toContainText('больше нуля')
    await expect(ranking(page)).toHaveCount(0)
    await expect(page.locator('.matrix')).toHaveCount(0)
  })

  test('быстрые изменения оставляют последнее состояние', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    for (const value of ['0.5', '0.7', '0.9']) await page.getByLabel('Вес vpub', { exact: true }).fill(value)
    const heavy = await decision(request, { ...M0, vpub: 0.9 })
    await ready(page, heavy.search.ranking[0].portfolio_id)
    await expect(page.getByLabel('Вес vpub', { exact: true })).toHaveValue('0.9')
  })

  test('±20 % описано как локальная проверка', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await expect(page.locator('#decision')).toContainText('локальная проверка двух весов')
    await expect(page.locator('[data-sensitivity]')).toHaveCount(data.sensitivity.runs.length)
  })
})

test.describe('STRESS как управленческое условие', () => {
  test('устойчивый состав: запас показан, стоимость не сокращается до нового лимита', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    test.skip(leader.scenarios.STRESS.status !== 'PASS', 'лидер не проходит STRESS в этой конфигурации')
    await boot(page, leader.portfolio_id)
    await ranking(page).first().getByRole('button', { name: 'В конструктор' }).click()
    await expect(page.getByTestId('metric-c0_mrub').locator('strong')).toHaveText(ru(leader.metrics.c0_mrub))

    const verdict = page.locator('.stress-verdict')
    await expect(verdict).toContainText('Состав сохраняется')
    await expect(verdict).toContainText(ru(leader.scenarios.STRESS.c0_margin))
    await expect(verdict).toContainText('снижение лимита не удешевляет портфель')
    await expect(verdict).toContainText('Устойчив в границах этого сценария STRESS')
    // Cost is identical under both conditions; only the cap moves.
    await expect(page.getByTestId('stress-summary-BASE')).toContainText(ru(leader.metrics.c0_mrub))
    await expect(page.getByTestId('stress-summary-STRESS')).toContainText(ru(leader.metrics.c0_mrub))
    await expect(page.locator('.budget-axis')).toContainText('Двигается только граница допустимого C0')
  })

  test('неустойчивый состав: точное нарушение, кандидаты, предпросмотр, применение и возврат', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await setRows(page, [['FIRE', 'A'], ['FLOOD', 'A'], ['INFRA', 'B'], ['ENV', 'A']])
    await expect(page.getByTestId('stress-summary-STRESS')).toContainText('FAIL', { timeout: 60_000 })

    const verdict = page.locator('.stress-verdict.breaks')
    await expect(verdict).toContainText('Состав не проходит STRESS')
    await expect(verdict).toContainText('нарушение')
    await expect(verdict).toContainText('не содержит переходных затрат')
    await expect(page.locator('.stress-actions')).toContainText('лучшего по score')
    await expect(page.locator('.stress-actions')).toContainText('минимально изменить состав')

    const candidates = page.getByRole('region', { name: 'Допустимые в STRESS кандидаты' }).locator('tbody tr')
    expect(await candidates.count()).toBeGreaterThan(0)
    const nameField = page.getByLabel('Название текущего варианта')
    const nameBefore = await nameField.inputValue()

    await candidates.first().getByRole('button', { name: 'Предпросмотр' }).click()
    const preview = page.locator('.stress-preview')
    await expect(preview).toContainText('Текущий состав не изменён')
    await expect(preview).toContainText('Сейчас')
    await expect(preview).toContainText('В предпросмотре')
    expect(await nameField.inputValue()).toBe(nameBefore) // preview does not apply

    await preview.getByRole('button', { name: 'Применить состав' }).click()
    await expect(nameField).not.toHaveValue(nameBefore)
    await expect(page.locator('.stress-restore')).toBeVisible()
    await page.getByRole('button', { name: 'Вернуть прежний состав', exact: true }).click()
    await expect(nameField).toHaveValue(nameBefore)
  })

  test('сценарий меняет только лимит C0, и это сказано явно', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await ranking(page).first().getByRole('button', { name: 'В конструктор' }).click()
    await expect(page.locator('#stress')).toContainText('Из девяти условий сценарий меняет только')
    await expect(page.locator('#stress')).toContainText('не две стадии ранжирования')
  })
})

test.describe('Границы формулировок', () => {
  test('нет запрещённых утверждений о прибыли, окупаемости и Парето', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    const text = await page.locator('body').innerText()
    expect(text).not.toContain('Парето-фронт')
    expect(text).not.toContain('Pareto frontier')
    expect(text).not.toContain('объективно оптимальный портфель')
    expect(text).toContain('не окупаемость')
    // The band heading is rendered uppercase by CSS, so compare case-insensitively.
    expect(text.toLowerCase()).toContain('vpub отдельно от cash')
  })
})

test.describe('Крайние состояния', () => {
  test('длинное название не ломает раскладку и не вызывает прокрутку страницы', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await ranking(page).first().getByRole('button', { name: 'В конструктор' }).click()
    const long = 'Межрегиональный портфель космических сервисов для паводков, пожаров и агроаналитики — редакция'
    await page.getByLabel('Название текущего варианта').fill(long)
    await expect(page.getByTestId('metric-c0_mrub').locator('strong')).toBeVisible()
    const bounds = await page.evaluate(() => ({ w: window.innerWidth, s: document.documentElement.scrollWidth }))
    expect(bounds.s).toBeLessThanOrEqual(bounds.w)
  })

  test('пустой конструктор: стресс-раздел просит состав и предлагает открыть предпочтительный', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await page.getByRole('button', { name: 'Сбросить всё', exact: true }).click()
    await expect(page.locator('#stress')).toContainText('Сначала выберите четыре лота')
    await page.getByRole('button', { name: 'Открыть предпочтительный состав', exact: true }).click()
    await expect(page.getByTestId('metric-c0_mrub').locator('strong')).toHaveText(ru(data.search.ranking[0].metrics.c0_mrub))
  })

  test('равные значения: правило разрешения ничьей объявлено', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await page.locator('#decision').getByText('Веса, фиксированная шкала и происхождение', { exact: true }).click()
    await expect(page.locator('#decision')).toContainText('При равенстве неокруглённого score')
    await expect(page.locator('#decision')).toContainText('лексикографический состав')
  })
})

test.describe('Доступность и адаптивность', () => {
  for (const [name, width, height] of [['desktop', 1440, 900], ['laptop', 1366, 768], ['tablet', 768, 1024], ['mobile', 390, 844]] as const) {
    test(`${name} ${width}×${height}: нет горизонтальной прокрутки страницы`, async ({ page, request }) => {
      const data = await decision(request)
      await page.setViewportSize({ width, height })
      await boot(page, data.search.ranking[0].portfolio_id)
      for (const id of ['overview', 'decision', 'stress', 'builder', 'comparison', 'implementation']) {
        await page.getByRole('navigation').locator(`a[href="#${id}"]`).click()
        await expect(page.locator(`#${id}`)).toBeInViewport()
        const bounds = await page.evaluate(() => ({ w: window.innerWidth, s: document.documentElement.scrollWidth }))
        expect(bounds.s, `${name}/${id} horizontal overflow`).toBeLessThanOrEqual(bounds.w)
      }
    })
  }

  test('статусы читаются текстом, а не только цветом', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await expect(page.locator('.matrix .badge').first()).not.toHaveText('')
    await expect(page.locator('.matrix')).toContainText('выполнено')
    await expect(page.locator('.matrix')).toContainText('PASS')
  })

  test('при reduced motion значения остаются на месте', async ({ page, request }) => {
    const data = await decision(request)
    const leader = data.search.ranking[0]
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await boot(page, leader.portfolio_id)
    await expect(atlas(page)).toContainText(ru(leader.metrics.c0_mrub))
    await expect(page.locator('.plot-svg')).toBeVisible()
    const duration = await page.locator('.funnel-bar i').first()
      .evaluate(node => getComputedStyle(node).transitionDuration)
    expect(['0s', '0.001s']).toContain(duration)
  })

  test('видимый фокус на интерактивных элементах', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
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
    await boot(page, data.search.ranking[0].portfolio_id)
    await page.locator('#implementation').scrollIntoViewIfNeeded()
    await expect(page.locator('#implementation')).toContainText('Release', { timeout: 120_000 })
    expect(external).toEqual([])
    expect(errors).toEqual([])
  })

  test('все прежние разделы и действия на месте', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    for (const name of ['Скачать JSON', 'Импорт JSON', 'Сбросить всё', 'Отменить изменение']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
    }
    for (const name of ['Веса M0', 'Равные веса', 'Скачать JSON выбора', 'Импорт выбора']) {
      await expect(page.locator('#decision').getByRole('button', { name, exact: true })).toHaveCount(1)
    }
    await expect(page.locator('#catalog').locator('tbody').first().locator('tr')).toHaveCount(8)
    await expect(page.locator('.slot')).toHaveCount(4)
    await expect(page.locator('#comparison .empty')).toBeVisible()
  })

  test('сохранённые материалы отделены от текущего расчёта', async ({ page, request }) => {
    const data = await decision(request)
    await boot(page, data.search.ranking[0].portfolio_id)
    await expect(page.locator('#implementation')).toContainText('относятся к принятой сохранённой конфигурации', { timeout: 120_000 })
    await expect(atlas(page)).toContainText('не меняются вместе с этим поиском')
  })
})
