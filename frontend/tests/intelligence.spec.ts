/** Budget correction tool: limit, mandatory services, feasible correction, boundary.
 *  Live canonical API results supply the expected data. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

test.setTimeout(120_000)

const budget = (page: Page) => page.locator('#view')

async function seed(page: Page, request: APIRequestContext, invalid = false) {
  const kase = await (await request.get('/api/case')).json()
  const method = await (await request.get('/api/decision-method')).json()
  const search = {
    format_version: 'kosmos-search/1', case_id: kase.case_id, case_version: kase.case_version,
    source_hashes: kase.source_hashes, modes: 'A/B/C', method_version: method.method_version,
    scenario: 'BASE', weights: method.weights, limit: 10, baseline: null,
  }
  const result = await (await request.post('/api/decision/recompute', { data: { format_version: 'kosmos-decision/1', request: search } })).json()
  const current = structuredClone(result.alternatives[0].request)
  if (invalid) current.selection.forEach((row: { mode_id: string }) => { row.mode_id = 'C' })
  await page.addInitScript(({ kase, current }) => localStorage.setItem('kosmos.workspace.v1', JSON.stringify({
    format_version: 'kosmos-workspace/1', source_hashes: kase.source_hashes,
    workspace: { current: { name: 'Browser DSS', request: current }, alternatives: [], scenario: 'BASE' },
  })), { kase, current })
  await page.goto('/#/stress/budget')
  await expect(budget(page).getByRole('button', { name: 'Найти допустимую корректировку' })).toBeEnabled({ timeout: 90_000 })
  return { current, search, result }
}

/** The overview reads /api/intelligence on its own for the recommendation, so the
 *  response of the tool is identified by the payload the tool sends, not by the URL. */
async function run(page: Page, subject: { selection: unknown[] }, expected: { locks?: number; cap?: number | null } = {}) {
  const matches = (item: { url: () => string; status: () => number; request: () => { postDataJSON: () => any } }) => {
    if (!item.url().endsWith('/api/intelligence') || item.status() !== 200) return false
    const body = item.request().postDataJSON()
    if (JSON.stringify(body.current.selection) !== JSON.stringify(subject.selection)) return false
    if (expected.locks !== undefined && body.locks.length !== expected.locks) return false
    if (expected.cap !== undefined && body.budget_cap !== expected.cap) return false
    return true
  }
  await budget(page).getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  const value = await (await page.waitForResponse(matches)).json()
  await expect(budget(page).getByTestId('intelligence-result')).toBeVisible()
  return value
}

test('недопустимый состав → корректировка, сравнение, без неявного применения', async ({ page, request }) => {
  const { current } = await seed(page, request, true)
  const result = await run(page, current, { locks: 0 })
  expect(result.current.feasible).toBe(false)
  expect(result.recovery.length).toBeGreaterThan(0)
  await expect(page.locator('.verdict')).toHaveAttribute('data-tone', 'fail')
  await expect(budget(page)).toContainText('Минимальное изменение')
  await expect(page.getByTestId('recovery-diff')).toContainText('Было')
  await expect(page.getByTestId('recovery-diff')).toContainText('Стало')

  await page.getByRole('button', { name: 'Сравнить корректировку' }).first().click()
  await expect(page.locator('.view-title')).toHaveText('Сравнение')
  await expect(page.locator('.alternative-actions article')).toHaveCount(2)
  await expect(page.locator('.comparison-table')).toBeVisible()

  // The manual composition itself is untouched by the comparison.
  await page.goto('/#/builder')
  for (let index = 0; index < 4; index++) {
    await expect(page.getByLabel(`Режим ${index + 1}`, { exact: true })).toHaveValue(current.selection[index].mode_id)
  }
})

test('свой лимит, отсутствие решения, обязательные сервисы и сброс', async ({ page, request }) => {
  const { current, result: official } = await seed(page, request)
  await budget(page).getByLabel('Лимит бюджета').fill('0')
  await expect(budget(page)).toContainText('свой лимит')
  const empty = await run(page, current, { cap: 0 })
  expect(empty.status).toBe('NO_SOLUTION')
  await expect(budget(page)).toContainText('Единственный барьер — лимит C0')

  await budget(page).getByLabel('Лимит бюджета').fill(String(empty.budget.minimum_feasible_budget))
  await expect(budget(page)).toContainText('Допустимые решения найдены', { timeout: 60_000 })
  await expect(budget(page)).toContainText('Граница устойчивости')

  await page.getByText('Зафиксировать конкретный режим', { exact: false }).click()
  for (const row of official.recommendation.base.selection) {
    await budget(page).getByLabel(`Обязательный сервис ${row.lot_id}`).selectOption('C')
  }
  await budget(page).getByLabel('Лимит бюджета').fill('1000000')
  await expect(budget(page)).toContainText('Снятие лимита C0 не даёт решения', { timeout: 60_000 })

  await page.getByRole('button', { name: 'Сбросить условия', exact: true }).click()
  await expect(budget(page)).toContainText('официальный лимит BASE')
  await expect(budget(page).getByTestId('intelligence-result')).toHaveCount(0)
  for (const row of official.recommendation.base.selection) {
    await expect(budget(page).getByLabel(`Обязательный сервис ${row.lot_id}`)).toHaveValue('')
  }
})

test('обязательный сервис и конкретный режим отправляют разные контракты', async ({ page, request }) => {
  const { current } = await seed(page, request)
  await page.getByText('Зафиксировать конкретный режим', { exact: false }).click()
  await budget(page).getByLabel('Обязательный сервис FLOOD', { exact: true }).selectOption('LOT')
  const lot = await run(page, current, { locks: 1 })
  expect(lot.locks).toEqual([{ lot_id: 'FLOOD', mode_id: null }])
  const response = page.waitForResponse(item => item.url().endsWith('/api/intelligence') && item.status() === 200)
  await budget(page).getByLabel('Обязательный сервис FLOOD', { exact: true }).selectOption('A')
  const mode = await (await response).json()
  expect(mode.feasible_count).toBeLessThan(lot.feasible_count)
})

test('загрузка, ошибка API, повтор и пустой лимит скрывают устаревший вывод', async ({ page, request }) => {
  const { current } = await seed(page, request)
  await page.route('**/api/intelligence', async route => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Controlled DSS unavailable' } }) })
  })
  await budget(page).getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  await expect(budget(page).getByRole('status')).toContainText('Перебираем')
  await expect(budget(page).getByRole('alert')).toContainText('Controlled DSS unavailable')
  await expect(budget(page).getByTestId('intelligence-result')).toHaveCount(0)

  await page.unroute('**/api/intelligence')
  await run(page, current, { locks: 0 })
  await budget(page).getByLabel('Лимит бюджета').fill('')
  await expect(budget(page).getByRole('alert')).toContainText('неотрицательный лимит')
  await expect(budget(page).getByTestId('intelligence-result')).toHaveCount(0)
})

test('карта допустимых вариантов, клавиатура и адресный дефицит в паспорте', async ({ page, request }) => {
  const { current } = await seed(page, request)
  const result = await run(page, current, { locks: 0 })
  await page.getByText('Карта допустимых вариантов', { exact: false }).click()
  await expect(budget(page).locator('svg circle[role="button"]')).toHaveCount(result.feasible_count)
  await budget(page).getByLabel('Вариант для сравнения').selectOption(result.explorer.points[1].portfolio_id)
  await expect(page.locator('.comparison-table')).toBeVisible()

  await page.goto('/#/builder')
  await page.getByRole('button', { name: 'Открыть паспорт', exact: true }).click()
  const passport = page.getByTestId('finance-flow')
  await expect(passport).toContainText('ENV A', { timeout: 60_000 })
  await expect(passport).toContainText('UNKNOWN')
  await expect(passport).toContainText('2,5')
})

test('корректировка бюджета переживает переход между разделами', async ({ page, request }) => {
  const { current } = await seed(page, request)
  await run(page, current, { locks: 0 })
  await page.goto('/#/overview')
  await expect(page.locator('.decision-card')).toBeVisible()
  await page.goto('/#/stress/budget')
  await expect(page.getByTestId('intelligence-result')).toBeVisible()
})

test('мобильная раскладка инструмента: без ошибок и внешних запросов', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', item => { if (!/^(http:\/\/127\.0\.0\.1|blob:|data:)/.test(item.url())) external.push(item.url()) })
  const { current } = await seed(page, request)
  await run(page, current, { locks: 0 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
