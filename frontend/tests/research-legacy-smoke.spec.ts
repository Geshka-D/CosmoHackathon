/** Current-route smoke of the old export/PDF/constructor scenarios; no material generation. */
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
test.setTimeout(150_000)

test('JSON export/import, strict constructor and Reset preserve canonical answers', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#/delivery/rationale')
  await page.getByRole('button', { name: 'Загрузить состав в конструктор', exact: true }).click({ timeout: 90_000 })
  await expect(page.getByLabel('Лот 1', { exact: true })).toHaveValue('AGRI')
  await expect(page.getByLabel('Режим 1', { exact: true })).toHaveValue('C')
  await expect(page.getByLabel('Лот 2', { exact: true }).locator('option[value="AGRI"]')).toHaveJSProperty('disabled', true)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click()
  const file = await downloaded
  const bytes = await readFile((await file.path())!)
  const exported = JSON.parse(bytes.toString())
  expect(JSON.stringify(exported)).not.toMatch(/cost_risk|research_c0|"sigma"/)
  await page.getByRole('button', { name: 'Сбросить всё', exact: true }).click()
  await expect(page.getByLabel('Лот 1', { exact: true })).toHaveValue('')
  await page.getByLabel('Файл JSON для импорта', { exact: true }).setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.getByLabel('Лот 1', { exact: true })).toHaveValue('AGRI')
  await expect(page.getByLabel('Режим 1', { exact: true })).toHaveValue('C')
  const restoredDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать JSON', exact: true }).click()
  const restored = JSON.parse((await readFile((await (await restoredDownload).path())!)).toString())
  expect(restored).toEqual(exported)
  expect(errors).toEqual([])
})

test('three active PDFs download byte-identically', async ({ page }) => {
  const pointer = JSON.parse(await readFile('../results/m5_current.json', 'utf8'))
  await page.goto('/#/delivery/materials')
  for (const [name, label] of [['note.pdf', 'Управленческая записка PDF'], ['stress.pdf', 'Стресс-резюме PDF'], ['slides.pdf', 'Презентация PDF']]) {
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: label, exact: true }).click({ timeout: 90_000 })
    const bytes = await readFile((await (await downloading).path())!)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pointer.files[name].sha256)
  }
})
