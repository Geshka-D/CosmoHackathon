/** Session-author UX regression. Expected decisions come from the live canonical API.
 * No control answers, slides, or independent acceptance claims. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.setTimeout(90_000)
const ru = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(n)
const composition = (rows: { lot_id: string; mode_id: string }[]) => rows.map(r => `${r.lot_id} ${r.mode_id}`).join(' · ')
const lab = (page: Page) => page.getByTestId('intelligence')
async function boot(page: Page, request: APIRequestContext) {
  const kase = await (await request.get('/api/case')).json()
  const method = await (await request.get('/api/decision-method')).json()
  const search = { format_version: 'kosmos-search/1', case_id: kase.case_id, case_version: kase.case_version,
    source_hashes: kase.source_hashes, modes: 'A/B/C', method_version: method.method_version,
    scenario: 'BASE', weights: method.weights, limit: 10, baseline: null }
  const official = await (await request.post('/api/decision/recompute', { data: { format_version: 'kosmos-decision/1', request: search } })).json()
  await page.goto('/')
  await expect(page.getByTestId('why-narrative')).toBeVisible({ timeout: 40_000 })
  await expect(page.locator('#financing').getByTestId('finance-flow')).toBeVisible({ timeout: 40_000 })
  await expect(page.getByRole('button', { name: 'Сформировать управленческий brief', exact: true })).toBeEnabled({ timeout: 40_000 })
  return { official, search, kase }
}
async function below(page: Page) {
  const reply = page.waitForResponse(r => r.url().endsWith('/api/intelligence') && r.request().postDataJSON().context === 'RESEARCH' && r.ok())
  await lab(page).getByRole('button', { name: 'Исследовать ниже breakpoint' }).click()
  const value = await (await reply).json()
  await expect(lab(page).getByTestId('intelligence-result')).toBeVisible()
  return value
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

test('complete 10-chapter jury demo, actual shock, recovery, locks, finance, brief, Back/Reset/exit', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { official } = await boot(page, request)
  const saved = await page.evaluate(() => JSON.stringify(localStorage))
  await page.screenshot({ path: 'out/session2/overview-laptop.png' })
  const launcher = page.getByRole('button', { name: 'Обзор решения', exact: true })
  await expect(launcher).toHaveClass(/quiet/)
  await expect(page.locator('body')).not.toContainText('Pitch Mode')
  await launcher.click()
  const controls = page.getByRole('complementary', { name: 'Управление защитой' })
  await expect(page.locator('#mission')).toBeVisible()
  await expect(controls.getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
  for (let step = 1; step < 10; step++) {
    await controls.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.locator('.product')).toHaveAttribute('data-pitch-step', String(step))
    await noOverflow(page)
    if (step === 1) {
      await page.getByRole('button', { name: 'Показать путь решения' }).click()
      await expect(page.locator('.corridor-count').first()).toHaveText(ru(official.search.population.total))
    }
    if (step === 3) {
      await expect(page.getByTestId('why-narrative')).toBeVisible()
      await expect(page.locator('.peer-verdicts article')).toHaveCount(2)
    }
    if (step === 4) {
      await expect(page.getByRole('region', { name: 'Матрица сравнения портфелей' })).toBeVisible()
      expect(await page.locator('.matrix thead th').count()).toBeGreaterThanOrEqual(4)
    }
    if (step === 5) {
      const shock = page.getByTestId('official-shock')
      await shock.getByRole('button', { name: 'STRESS', exact: true }).click()
      await expect(shock).toContainText(ru(official.recommendation.base.scenarios.STRESS.c0_margin))
      await expect(shock.locator('.shock-selection')).toHaveText(composition(official.recommendation.base.selection))
      await expect(shock.locator('.shock-numbers > div').first()).toContainText(ru(official.recommendation.base.metrics.c0_mrub))
    }
    if (step === 6) {
      const result = await below(page)
      expect(result.current.feasible).toBe(false)
      expect(result.recovery.length).toBeGreaterThan(0)
      await expect(lab(page).getByTestId('recovery-diff').first()).toBeVisible()
      await lab(page).getByTestId('recovery-diff').first().screenshot({ path: 'out/session2/recovery-diff.png' })
      const prior = result.recovery.find((p: any) => p.changes.removed.length > 0)
      expect(prior).toBeTruthy()
      const required = prior.changes.removed[0]
      await lab(page).getByRole('group', { name: 'Стратегия корректировки' }).getByRole('button').nth(result.recovery.indexOf(prior)).click()
      const selectedDiff = lab(page).locator('.recovery-proposal:not([hidden])')
      await expect(selectedDiff).toContainText(`${required} ${result.current.candidate.selection.find((r: any) => r.lot_id === required).mode_id} →`)
      await selectedDiff.screenshot({ path: 'out/session2/recovery-service-exchange.png' })
      const response = page.waitForResponse(r => r.url().endsWith('/api/intelligence') && r.request().postDataJSON().locks.some((l: any) => l.lot_id === required) && r.ok())
      await lab(page).getByRole('button', { name: `Зафиксировать ${required}`, exact: true }).click()
      const locked = await (await response).json()
      await expect(lab(page).getByRole('button', { name: `Снять lock ${required}` })).toBeVisible()
      expect(locked.recovery.every((p: any) => p.candidate.selection.some((r: any) => r.lot_id === required))).toBe(true)
      expect(locked.recovery.some((p: any) => p.candidate.portfolio_id === prior.candidate.portfolio_id)).toBe(false)
      await expect(lab(page)).toContainText(locked.message)
      await expect(lab(page).locator('.recovery-proposal:not([hidden])')).not.toContainText(`${required} A →`)
      await page.screenshot({ path: 'out/session2/pitch-locks.png' })
      await lab(page).getByRole('button', { name: 'Reset DSS', exact: true }).click()
    }
    if (step === 7) {
      await expect(page.locator('#financing .responsibility-chain li')).toHaveCount(5)
      await page.locator('#financing .service-tabs button').nth(1).click()
      await expect(page.locator('#financing')).toContainText('UNKNOWN')
    }
    if (step === 9) {
      await page.getByRole('button', { name: 'Сформировать управленческий brief', exact: true }).click()
      await expect(page.locator('.brief-sections > li')).toHaveCount(9)
      await expect(page.locator('.brief-sections')).not.toContainText('Research breakpoint')
      await expect(controls.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    }
    await page.screenshot({ path: `out/session2/pitch-${step}.png` })
  }
  await controls.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('#conditions')).toBeVisible()
  await controls.getByRole('button', { name: 'С начала', exact: true }).click()
  await expect(page.locator('#mission')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.product')).not.toHaveClass(/pitch-active/)
  await expect(page.getByRole('button', { name: 'Обзор решения', exact: true })).toBeFocused()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(saved)
  expect(errors).toEqual([])
})

test('research brief uses the recovered recommendation passport, exports deterministic Markdown, hides stale output', async ({ page, request }) => {
  await boot(page, request)
  const result = await below(page)
  const brief = page.getByTestId('decision-brief')
  const generate = brief.getByRole('button', { name: 'Сформировать управленческий brief' })
  await expect(generate).toBeEnabled({ timeout: 30_000 })
  await generate.click()
  await expect(brief.locator('.brief-sections > li')).toHaveCount(10)
  await expect(brief).toContainText('Research breakpoint')
  await expect(brief.locator('.brief-sections > li').first()).toContainText(composition(result.recommendation.candidate.selection))
  await expect(brief).toContainText(ru(result.recommendation.candidate.metrics.c0_mrub))
  await expect(page.locator('#financing')).toContainText(composition(result.recommendation.candidate.selection))
  await expect(page.locator('#financing .finance-ledgers article').first()).toContainText(ru(result.recommendation.candidate.metrics.c0_mrub))
  const files: string[] = []
  for (let i = 0; i < 2; i++) {
    const event = page.waitForEvent('download')
    await brief.getByRole('button', { name: 'Скачать brief · Markdown' }).click()
    const file = await event
    expect(file.suggestedFilename()).toBe('kosmos-decision-brief.md')
    files.push(await readFile((await file.path())!, 'utf8'))
  }
  expect(files[0]).toBe(files[1])
  expect(files[0]).toContain('RESEARCH')
  expect(files[0]).toContain('UNKNOWN')
  await lab(page).getByLabel('Research budget cap', { exact: true }).fill('0')
  await expect(brief.locator('.brief-sections')).toHaveCount(0)
  await expect(brief).toContainText('Допустимого решения нет', { timeout: 30_000 })
  await expect(generate).toBeDisabled()
  await lab(page).getByRole('button', { name: 'Reset DSS' }).click()
  await expect(generate).toBeEnabled()
  await generate.click()
  await expect(brief.locator('.brief-sections > li')).toHaveCount(9)
  await expect(brief.locator('.brief-sections')).not.toContainText('Research breakpoint')
})

test('official DSS scenario and locks own the brief and finance context, Reset returns main recommendation', async ({ page, request }) => {
  const { official } = await boot(page, request)
  await lab(page).getByLabel('Сценарий DSS', { exact: true }).selectOption('STRESS')
  await lab(page).getByText('Обязательные сервисы / locks', { exact: true }).click()
  // A valid service absent from the current recommendation constrains the search.
  const required = 'FIRE'
  await lab(page).getByLabel(`Lock ${required}`, { exact: true }).selectOption('A')
  const response = page.waitForResponse(r => r.url().endsWith('/api/intelligence') && r.request().postDataJSON().locks.some((l: any) => l.lot_id === required) && r.ok())
  await lab(page).getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  const value = await (await response).json()
  expect(value.recommendation).toBeTruthy()
  const brief = page.getByTestId('decision-brief')
  await expect(brief.getByRole('button', { name: 'Сформировать управленческий brief' })).toBeEnabled({ timeout: 30_000 })
  await brief.getByRole('button', { name: 'Сформировать управленческий brief' }).click()
  await expect(brief).toContainText('OFFICIAL / STRESS')
  await expect(brief).toContainText('Locks: FIRE A')
  await expect(brief.locator('.brief-sections > li').first()).toContainText(composition(value.recommendation.candidate.selection))
  await expect(page.locator('#financing')).toContainText(composition(value.recommendation.candidate.selection))
  await lab(page).getByRole('button', { name: 'Reset DSS' }).click()
  await expect(brief.locator('.brief-sections')).toHaveCount(0)
  await expect(page.locator('#financing')).toContainText(composition(official.search.ranking[0].selection), { timeout: 30_000 })
})

test('budget interval click, exact breakpoint, recovery compare, active lock removal and custom finance', async ({ page, request }) => {
  const { official } = await boot(page, request)
  const result = await below(page)
  await lab(page).getByRole('button', { name: 'Проверить точный breakpoint' }).click()
  await expect(lab(page).locator('.lab-verdict')).toHaveAttribute('data-feasible', 'true', { timeout: 30_000 })
  await lab(page).getByTestId('budget-map').locator('.transition-stations button').nth(1).click()
  await expect(lab(page).getByLabel('Research budget cap', { exact: true })).toHaveValue(String(result.transition_map[0].economic_breakpoint_c0))
  await expect(lab(page).getByTestId('recovery-diff').first()).toBeVisible()
  await lab(page).getByRole('button', { name: 'Сравнить корректировку', exact: true }).first().click()
  await expect(page.locator('#comparison .alternative-actions article')).toHaveCount(2)
  await expect(page.locator('#comparison .comparison-table')).toBeVisible()
  for (let i = 1; i <= 4; i++) await expect(page.getByLabel(`Лот ${i}`, { exact: true })).toHaveValue('')
  const required = official.recommendation.base.selection[0].lot_id
  await lab(page).getByRole('button', { name: `Зафиксировать ${required}`, exact: true }).click()
  await lab(page).getByRole('button', { name: `Снять lock ${required}`, exact: true }).click()
  await expect(lab(page).locator('.lock-strip')).toContainText('Нет фиксаций')
  await lab(page).getByRole('button', { name: 'Открыть паспорт', exact: true }).click()
  await expect(lab(page).getByTestId('dss-passport')).toBeVisible({ timeout: 30_000 })
})

test('finance unavailable disables brief and retries; no invented fallback', async ({ page, request }) => {
  await page.route('**/api/passport', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test passport unavailable' } }) }))
  await page.goto('/')
  const brief = page.getByTestId('decision-brief')
  await expect(brief.getByRole('alert')).toContainText('Test passport unavailable', { timeout: 30_000 })
  await expect(brief.getByRole('button', { name: 'Сформировать управленческий brief' })).toBeDisabled()
  await expect(page.getByTestId('why-narrative')).toBeVisible()
  expect((await request.get('/api/health')).ok()).toBe(true)
  await page.unroute('**/api/passport')
  await brief.getByRole('button', { name: 'Повторить паспорт для brief' }).click()
  await expect(brief.getByRole('button', { name: 'Сформировать управленческий brief' })).toBeEnabled({ timeout: 30_000 })
})

for (const width of [390, 768]) test(`responsive ${width}, reduced motion, local-only requests and Pitch exit`, async ({ page, request, baseURL }) => {
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = [], external: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (!r.url().startsWith(baseURL!) && !r.url().startsWith('blob:')) external.push(r.url()) })
  await boot(page, request)
  await page.getByRole('button', { name: 'Показать путь решения' }).click()
  expect(await page.locator('.corridor-steps li').first().evaluate(e => getComputedStyle(e).animationName)).toBe('none')
  await below(page)
  await noOverflow(page)
  await page.locator('#intelligence').screenshot({ path: `out/session2/lab-${width}.png` })
  await page.getByRole('button', { name: 'Обзор решения', exact: true }).click()
  for (let i = 0; i < 9; i++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await noOverflow(page)
  }
  await page.getByRole('button', { name: 'Закрыть обзор', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Обзор решения', exact: true })).toBeVisible()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})
