/** Author browser tests over the current accepted UI, with real API calculations. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
test.setTimeout(120_000)

async function start(page: Page, request: APIRequestContext) {
  const kase = await (await request.get('/api/case')).json()
  const method = await (await request.get('/api/decision-method')).json()
  const decision = await (await request.post('/api/decision/recompute', { data: {
    format_version: 'kosmos-decision/1', request: { format_version: 'kosmos-search/1',
      case_id: kase.case_id, case_version: kase.case_version, source_hashes: kase.source_hashes,
      modes: 'A/B/C', method_version: method.method_version, scenario: 'BASE', weights: method.weights, limit: 10, baseline: null },
  } })).json()
  const current = decision.alternatives[0].request
  await page.addInitScript(({ kase, current }) => localStorage.setItem('kosmos.workspace.v1', JSON.stringify({
    format_version: 'kosmos-workspace/1', source_hashes: kase.source_hashes,
    workspace: { current: { name: 'Research browser', request: current }, alternatives: [], scenario: 'BASE' },
  })), { kase, current })
  await page.goto('/#/stress/budget')
  await expect(page.getByRole('button', { name: 'Найти допустимую корректировку' })).toBeEnabled({ timeout: 90_000 })
  await page.locator('summary').filter({ hasText: /^Удорожание и эффект изменения бюджета/ }).click()
  await page.getByRole('checkbox', { name: 'Включить исследование C0 и бюджета' }).check()
  await page.getByRole('spinbutton', { name: 'Лимит бюджета', exact: true }).fill('1180')
}
function reply(page: Page, u: number) {
  return page.waitForResponse(r => r.url().endsWith('/api/research-math') && r.status() === 200 && r.request().postDataJSON().u === u)
}

test('надбавка, порог VPUB, те же условия Recovery, сравнение и Reset', async ({ page, request }) => {
  await start(page, request)
  const before = await page.evaluate(() => localStorage.getItem('kosmos.workspace.v1'))
  const response = reply(page, 0)
  await page.getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  const value = await (await response).json()
  expect(value.budget_effect.current.vpub).toBeCloseTo(1370.4)
  expect(value.budget_effect.next.budget_threshold).toBe(1186.5)
  await expect(page.getByTestId('research-math-result')).toBeVisible()
  const path = await page.getByTestId('vpub-step-path').getAttribute('d')
  expect(path).toMatch(/^M/); expect(path).toContain('H'); expect(path).toContain('V'); expect(path).not.toMatch(/[LQC]/)
  const inflated = reply(page, .05)
  await page.getByRole('spinbutton', { name: 'Исследовательская надбавка u', exact: true }).fill('0.05')
  const result = await (await inflated).json()
  expect(result.analysis.feasible_count).toBe(1)
  expect(result.analysis.recovery.every((p: any) => p.research_check.feasible && p.research_check.u === .05 && p.research_check.cap === 1180)).toBe(true)
  await expect(page.getByTestId('research-math-result')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('kosmos.workspace.v1'))).toBe(before)
  await page.getByRole('button', { name: 'Сравнить текущий максимум VPUB', exact: true }).click()
  await expect(page).toHaveURL(/compare|comparison/)
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Стресс', exact: true }).click()
  await page.getByRole('button', { name: 'Корректировка бюджета', exact: true }).click()
  await expect(page.getByTestId('research-math-result')).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить условия', exact: true }).click()
  await expect(page.getByTestId('research-math-result')).toHaveCount(0)
  await page.locator('summary').filter({ hasText: /^Удорожание и эффект изменения бюджета/ }).click()
  await expect(page.getByRole('checkbox', { name: 'Включить исследование C0 и бюджета' })).not.toBeChecked()
})

test('optional risk sends actual settings and never a hidden preset', async ({ page, request }) => {
  await start(page, request)
  await page.getByRole('spinbutton', { name: 'Исследовательская надбавка u', exact: true }).fill('.03')
  await page.locator('summary').filter({ hasText: /^Риск затрат · optional RESEARCH/ }).click()
  await page.getByRole('checkbox', { name: 'Оценить условную вероятность бюджета' }).check()
  await expect(page.getByRole('button', { name: 'Найти допустимую корректировку' })).toBeDisabled()
  await page.getByRole('spinbutton', { name: 'Риск sigma', exact: true }).fill('.07')
  await page.getByRole('spinbutton', { name: 'Риск rho', exact: true }).fill('.4')
  await page.getByRole('spinbutton', { name: 'Риск q', exact: true }).fill('.95')
  const response = reply(page, .03)
  await page.getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  const value = await (await response).json()
  expect(value.cost_risk.settings).toMatchObject({ u: .03, sigma: .07, rho: .4, q: .95 })
  await page.getByText('Результат модели риска затрат · RESEARCH', { exact: true }).click()
  await expect(page.getByText('Исследовательская модель. Параметры не оценены по реальным данным. Вероятность условна на выбранных допущениях.', { exact: true })).toBeVisible()
  await expect(page.getByText('Недостающий бюджет', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'out/research-risk-desktop.png', fullPage: true })
})

test('loading, API error, cancellation, stale responses, empty result and locks', async ({ page, request }) => {
  await start(page, request)
  await page.route('**/api/research-math', async route => {
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Research unavailable' } }) })
  })
  await page.getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  await expect(page.getByRole('button', { name: 'Отменить расчёт' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Research unavailable')
  await page.unroute('**/api/research-math')
  await page.route('**/api/research-math', async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 1800))
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  await page.getByRole('button', { name: 'Отменить расчёт' }).click()
  await expect(page.getByTestId('research-math-result')).toHaveCount(0)
  await page.unroute('**/api/research-math')
  await page.getByRole('spinbutton', { name: 'Исследовательская надбавка u', exact: true }).fill('.1')
  const response = reply(page, .1)
  await page.getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  expect((await (await response).json()).analysis.recovery).toEqual([])
  await expect(page.getByTestId('research-math-result')).toBeVisible()
  await expect(page.getByText('Предложенная корректировка', { exact: true })).toHaveCount(0)
  await page.getByRole('spinbutton', { name: 'Исследовательская надбавка u', exact: true }).fill('.05')
  await page.locator('summary').filter({ hasText: /^Зафиксировать конкретный режим/ }).click()
  const lockedReply = page.waitForResponse(r => r.url().endsWith('/api/research-math') && r.status() === 200
    && r.request().postDataJSON().u === .05 && r.request().postDataJSON().intelligence.locks.some((lock: any) => lock.lot_id === 'FLOOD' && lock.mode_id === 'A'))
  await page.getByRole('combobox', { name: 'Обязательный сервис FLOOD', exact: true }).selectOption('A')
  const locked = await (await lockedReply).json()
  expect(locked.analysis.recovery).toEqual([])
  expect(locked.settings.locks).toContainEqual({ lot_id: 'FLOOD', mode_id: 'A' })
  await expect(page.getByTestId('research-math-result')).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Исследовательская надбавка u', exact: true }).fill('')
  await expect(page.getByTestId('research-math-result')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Найти допустимую корректировку' })).toBeDisabled()
})

test('mobile research stays within viewport and keeps overview secondary', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page, request)
  const response = reply(page, 0)
  await page.getByRole('button', { name: 'Найти допустимую корректировку' }).click()
  await response
  await expect(page.getByTestId('research-math-result')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'out/research-mobile.png', fullPage: true })
})
