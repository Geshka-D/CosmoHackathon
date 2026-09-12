/** Single-session author tests; live canonical API results supply expected data. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

test.setTimeout(90_000)
const panel = (page: Page) => page.getByTestId('intelligence')
async function seed(page: Page, request: APIRequestContext, invalid = false) {
  const kase = await (await request.get('/api/case')).json()
  const method = await (await request.get('/api/decision-method')).json()
  const search = { format_version: 'kosmos-search/1', case_id: kase.case_id, case_version: kase.case_version,
    source_hashes: kase.source_hashes, modes: 'A/B/C', method_version: method.method_version,
    scenario: 'BASE', weights: method.weights, limit: 10, baseline: null }
  const result = await (await request.post('/api/decision/recompute', { data: { format_version: 'kosmos-decision/1', request: search } })).json()
  const current = structuredClone(result.alternatives[0].request)
  if (invalid) current.selection.forEach((r: { mode_id: string }) => { r.mode_id = 'C' })
  await page.addInitScript(({ kase, current }) => localStorage.setItem('kosmos.workspace.v1', JSON.stringify({
    format_version: 'kosmos-workspace/1', source_hashes: kase.source_hashes,
    workspace: { current: { name: 'Browser DSS', request: current }, alternatives: [], scenario: 'BASE' },
  })), { kase, current })
  await page.goto('/')
  await expect(panel(page).getByRole('button', { name: 'Найти допустимую корректировку' })).toBeEnabled({ timeout: 30_000 })
  return { current, search, result }
}
async function run(page: Page) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/intelligence') && r.status() === 200)
  await panel(page).getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  const value = await (await response).json()
  await expect(panel(page).getByTestId('intelligence-result')).toBeVisible()
  return value
}

test('invalid → feasible recovery, click compare, no implicit apply', async ({ page, request }) => {
  const { current } = await seed(page, request, true)
  const result = await run(page)
  expect(result.current.feasible).toBe(false)
  expect(result.recovery.length).toBeGreaterThan(0)
  await expect(panel(page)).toContainText('A · минимальное изменение')
  await panel(page).getByRole('button', { name: 'Сравнить корректировку' }).first().click()
  await expect(page.locator('#comparison .alternative-actions article')).toHaveCount(2)
  await expect(page.locator('#comparison .comparison-table')).toBeVisible()
  for (let i = 0; i < 4; i++) await expect(page.getByLabel(`Режим ${i + 1}`, { exact: true })).toHaveValue(current.selection[i].mode_id)
})

test('research boundaries, no-solution, locks and Reset', async ({ page, request }) => {
  const { result: official } = await seed(page, request)
  await panel(page).getByLabel('Контекст DSS').selectOption('RESEARCH')
  await panel(page).getByLabel('Research budget cap').fill('0')
  const empty = await run(page)
  expect(empty.status).toBe('NO_SOLUTION')
  await expect(panel(page)).toContainText('Единственный оставшийся барьер — C0 cap')
  await panel(page).getByLabel('Research budget cap').fill(String(empty.budget.minimum_feasible_budget))
  await expect(panel(page)).toContainText('Допустимые решения найдены.', { timeout: 30_000 })
  await panel(page).getByText('Обязательные сервисы / locks', { exact: true }).click()
  for (const row of official.recommendation.base.selection) await panel(page).getByLabel(`Lock ${row.lot_id}`).selectOption('C')
  await panel(page).getByLabel('Research budget cap').fill('1000000')
  await expect(panel(page)).toContainText('Снятие C0 cap не даёт решения.', { timeout: 30_000 })
  await panel(page).getByRole('button', { name: 'Reset DSS' }).click()
  await expect(panel(page).getByLabel('Контекст DSS')).toHaveValue('OFFICIAL')
  await expect(panel(page).getByTestId('intelligence-result')).toHaveCount(0)
  for (const row of official.recommendation.base.selection) await expect(panel(page).getByLabel(`Lock ${row.lot_id}`)).toHaveValue('')
})

test('lot lock and mode lock send different contracts; STRESS filter', async ({ page, request }) => {
  await seed(page, request)
  await panel(page).getByText('Обязательные сервисы / locks', { exact: true }).click()
  await panel(page).getByLabel('Lock FLOOD').selectOption('LOT')
  const lot = await run(page)
  expect(lot.locks).toEqual([{ lot_id: 'FLOOD', mode_id: null }])
  const response = page.waitForResponse(r => r.url().endsWith('/api/intelligence') && r.status() === 200)
  await panel(page).getByLabel('Lock FLOOD').selectOption('A')
  const mode = await (await response).json()
  expect(mode.feasible_count).toBeLessThan(lot.feasible_count)
  await panel(page).getByLabel('Сценарий DSS').selectOption('STRESS')
  await expect(panel(page).getByTestId('intelligence-result')).toContainText('STRESS:', { timeout: 30_000 })
})

test('loading, API error, retry, invalid cap hide stale output', async ({ page, request }) => {
  await seed(page, request)
  await page.route('**/api/intelligence', async route => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Controlled DSS unavailable' } }) })
  })
  await panel(page).getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  await expect(panel(page).getByRole('status')).toContainText('Перебираем')
  await expect(panel(page).getByRole('alert')).toContainText('Controlled DSS unavailable')
  await expect(panel(page).getByTestId('intelligence-result')).toHaveCount(0)
  await page.unroute('**/api/intelligence')
  await run(page)
  await panel(page).getByLabel('Контекст DSS').selectOption('RESEARCH')
  await panel(page).getByLabel('Research budget cap').fill('')
  await expect(panel(page).getByRole('alert')).toContainText('неотрицательный cap')
  await expect(panel(page).getByTestId('intelligence-result')).toHaveCount(0)
})

test('out-of-order response and Reset cannot restore stale research', async ({ page, request }) => {
  await seed(page, request)
  const pending: Promise<void>[] = []
  await page.route('**/api/intelligence', route => {
    const body = route.request().postDataJSON()
    const work = (async () => {
      const response = await route.fetch()
      if (body.budget_cap === 0) await new Promise(resolve => setTimeout(resolve, 1800))
      await route.fulfill({ response })
    })()
    pending.push(work)
    return work
  })
  await panel(page).getByLabel('Контекст DSS').selectOption('RESEARCH')
  await panel(page).getByLabel('Research budget cap').fill('0')
  const first = page.waitForRequest(r => r.url().endsWith('/api/intelligence') && r.postDataJSON().budget_cap === 0)
  await panel(page).getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  await first
  await panel(page).getByLabel('Research budget cap').fill('1300')
  await expect(panel(page).getByTestId('intelligence-result')).toContainText('Допустимые решения найдены.', { timeout: 30_000 })
  await Promise.all(pending)
  await expect(panel(page).getByTestId('intelligence-result')).toContainText('Cap 1 300')
  const next = page.waitForRequest(r => r.url().endsWith('/api/intelligence') && r.postDataJSON().budget_cap === 0)
  await panel(page).getByLabel('Research budget cap').fill('0')
  await next
  await panel(page).getByRole('button', { name: 'Reset DSS' }).click()
  await Promise.all(pending)
  await expect(panel(page).getByTestId('intelligence-result')).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kosmos.workspace.v1')!))
  expect(stored.workspace.scenario).toBe('BASE')
  expect(JSON.stringify(stored)).not.toContain('budget_cap')
})

test('all feasible plot, keyboard comparison, finance provenance and real sensitivity', async ({ page, request }) => {
  await seed(page, request)
  const result = await run(page)
  await expect(panel(page).locator('svg circle[role="button"]')).toHaveCount(result.feasible_count)
  await panel(page).getByLabel('Вариант Explorer').selectOption(result.explorer.points[1].portfolio_id)
  await expect(page.locator('#comparison .comparison-table')).toBeVisible()
  await panel(page).getByRole('button', { name: 'Открыть паспорт', exact: true }).click()
  await expect(panel(page).getByTestId('dss-passport')).toContainText('ENV A', { timeout: 30_000 })
  await expect(panel(page).getByTestId('dss-passport')).toContainText('service gap 2,5')
  await expect(panel(page).getByTestId('dss-passport')).toContainText('UNKNOWN')
  await panel(page).getByText('Локальная sensitivity ±20% · сохранённая рекомендация', { exact: true }).click()
  await expect(panel(page)).toContainText(result.accepted_recommendation_id)
  expect(result.local_sensitivity).toHaveLength(4)
  await panel(page).screenshot({ path: 'out/intelligence-desktop.png' })
})

test('new panel mobile layout, no page errors or external requests', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8011') && !r.url().startsWith('blob:')) external.push(r.url()) })
  await seed(page, request)
  await run(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
  expect(external).toEqual([])
  await panel(page).screenshot({ path: 'out/intelligence-mobile.png' })
})
