/** Guided overview, implementation screen and the decision card. The walk-through drives
 *  the real navigation: there is no separate presentation mode and no hidden duplicate of
 *  a screen. */
import { expect, test, type Page } from '@playwright/test'

test.setTimeout(180_000)

const view = (page: Page) => page.locator('#view')

async function boot(page: Page) {
  await page.goto('/#/overview')
  await expect(page.locator('.decision-card .object-title')).toBeVisible({ timeout: 150_000 })
}

test.describe('Обзор решения: пошаговый проход', () => {
  test('восемь шагов ведут по настоящим разделам и закрываются', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Обзор решения', exact: true }).click()
    const tour = page.getByRole('region', { name: 'Обзор решения' })
    await expect(tour).toContainText('Шаг 1 из 8')
    await expect(page.locator('.view-title')).toHaveText('Обзор')

    await tour.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(tour).toContainText('Шаг 2 из 8')
    await expect(page).toHaveURL(/#\/search\/shortlist$/)

    await tour.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(page).toHaveURL(/#\/search\/why$/)
    await tour.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/#\/search\/shortlist$/)

    // Escape closes the walk-through and leaves the user on the screen they reached.
    await page.keyboard.press('Escape')
    await expect(tour).toHaveCount(0)
    await expect(page).toHaveURL(/#\/search\/shortlist$/)
  })

  test('последний шаг заканчивает проход, а не обрывает его', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Обзор решения', exact: true }).click()
    const tour = page.getByRole('region', { name: 'Обзор решения' })
    for (let step = 0; step < 7; step++) await tour.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(tour).toContainText('Шаг 8 из 8')
    await expect(tour.getByRole('button', { name: 'Далее', exact: true })).toBeDisabled()
    await expect(page).toHaveURL(/#\/delivery\/materials$/)
    await tour.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(tour).toHaveCount(0)
  })
})

test.describe('Реализация решения', () => {
  test('первый экран отдаёт деньги решения, затем вкладки', async ({ page }) => {
    await boot(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Реализация', exact: true }).click()
    const hero = page.locator('.delivery-hero')
    await expect(hero).toBeVisible({ timeout: 150_000 })
    for (const label of ['Старт', 'Год эксплуатации', 'Денежный поток', 'Адресные дефициты']) {
      await expect(hero).toContainText(label)
    }
    await expect(page.locator('.reason')).not.toHaveCount(0)
    // The release hash is technical metadata, not headline content.
    await expect(view(page)).not.toContainText('Release')

    await page.getByRole('button', { name: 'Финансирование', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Финансирование сохранённого портфеля' })).toBeVisible()
    await expect(view(page)).toContainText('Портфельный дефицит')

    await page.getByRole('button', { name: 'Сервисы', exact: true }).click()
    await expect(page.locator('.service-card')).toHaveCount(4)

    await page.getByRole('button', { name: 'Материалы', exact: true }).click()
    await expect(view(page)).toContainText('Материалы сохранённого выпуска')
    await page.getByText('Происхождение и версия выпуска', { exact: false }).click()
    await expect(view(page)).toContainText('Выпуск')
  })

  test('цепочка ответственности показывает происхождение каждого утверждения', async ({ page }) => {
    await boot(page)
    await page.goto('/#/delivery/finance')
    const chain = page.locator('.responsibility-chain')
    await expect(chain).toBeVisible({ timeout: 150_000 })
    await expect(chain.locator('li')).toHaveCount(5)
    await expect(chain).toContainText('Кто финансирует')
    await expect(page.getByTestId('finance-flow')).toContainText('UNKNOWN')
  })
})

test.describe('Карточка решения', () => {
  test('собирается из текущего расчёта и содержит обязательные разделы', async ({ page }) => {
    await boot(page)
    await page.goto('/#/delivery/materials')
    const build = page.getByRole('button', { name: 'Собрать карточку', exact: true })
    await expect(build).toBeEnabled({ timeout: 150_000 })
    await build.click()
    const sections = page.locator('.brief-sections li')
    expect(await sections.count()).toBeGreaterThanOrEqual(9)
    for (const title of ['Рекомендация', 'Почему выбрана', 'Официальный STRESS', 'Финансирование', 'Что контролировать дальше']) {
      await expect(page.locator('.brief-sections')).toContainText(title)
    }
    await expect(page.getByRole('button', { name: 'Скачать · Markdown' })).toBeVisible()
  })
})

test.describe('Целостность оболочки', () => {
  test('шесть разделов, один источник сценария, локальные запросы', async ({ page }) => {
    const external: string[] = []
    const errors: string[] = []
    page.on('request', item => { if (!/^(http:\/\/127\.0\.0\.1|http:\/\/localhost|blob:|data:)/.test(item.url())) external.push(item.url()) })
    page.on('pageerror', error => errors.push(String(error)))
    await boot(page)

    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav.getByRole('button')).toHaveCount(6)
    // One scenario control for the whole product.
    await expect(page.getByRole('group', { name: 'Сценарий' }).getByRole('button')).toHaveCount(2)
    await page.getByRole('group', { name: 'Сценарий' }).getByRole('button', { name: 'STRESS', exact: true }).click()
    await expect(page.locator('.topbar-limit')).toContainText('1 180')
    await expect(view(page)).toContainText('STRESS · лимит C0 1 180', { timeout: 150_000 })

    expect(external).toEqual([])
    expect(errors).toEqual([])
  })

  test('состояние разделов переживает перезагрузку по ссылке', async ({ page }) => {
    await boot(page)
    await page.goto('/#/compare/saved')
    await expect(page.locator('.view-title')).toHaveText('Сравнение')
    await page.reload()
    await expect(page.locator('.view-title')).toHaveText('Сравнение')
    await expect(page.getByRole('button', { name: 'Сохранённые составы', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})
