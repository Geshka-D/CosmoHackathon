/** The decision card: one downloadable summary assembled from the current calculation.
 *  Nothing is written here that the screens do not already show; the text is generated
 *  from server values so an exported card cannot drift from the tool. */
import { useState } from 'react'
import { download } from './api'
import { composition } from './decision'
import { format, metricHuman, metricNames, signed } from './presentation'
import { Block, Callout, Disclosure, Fact, Facts } from './ui'
import type { Intelligence, MainDifference, Passport } from './intelligence'
import { usePassport } from './useEvidence'
import type { Catalog, RequestInput } from './types'

function difference(value: MainDifference, catalog: Catalog) {
  return value
    ? `${metricHuman[value.metric] || metricNames[value.metric]}: ${signed(value.raw_delta)} ${catalog.units[value.metric] || ''}; вклад в преимущество score ${signed(value.score_contribution_delta)}`
    : 'Отдельный фактор не выделяется по взвешенным критериям.'
}

export function briefSections(value: Intelligence, passport: Passport, catalog: Catalog) {
  const candidate = value.recommendation!.candidate, explanation = value.explanation!, totals = passport.finance.totals
  const peers = explanation.nearest_alternatives.slice(0, 2)
  const rows = [
    { title: 'Рекомендация', text: `${composition(candidate.selection)}. ${value.context} / ${value.active_scenario}; лимит ${format(value.budget.cap)} млн руб.; ${value.feasible_count} допустимых при текущих условиях. C0 ${format(candidate.metrics.c0_mrub)} млн руб.; OPEX ${format(candidate.metrics.opex_mrub_per_year)} млн руб./год; VPUB ${format(candidate.metrics.vpub_mrub_per_year)} синтет. млн руб./год; CASH ${format(candidate.metrics.cash_mrub_per_year)} млн руб./год; KCASH ${format(candidate.metrics.kcash, 6)}.` },
    { title: 'Почему выбрана', text: `${explanation.interpretation} Главный выигрыш относительно второго места: ${difference(explanation.main_gain_against_runner_up, catalog)}. При равном score действуют меньший C0 и лексикографический состав.` },
    { title: 'Главные альтернативы', text: peers.length ? peers.map(peer => { const point = value.explorer.points.find(item => item.portfolio_id === peer.portfolio_id)!; return `${composition(point.selection)} — отрыв по score ${format(peer.score_gap, 6)}; C0 ${format(point.metrics.c0_mrub)} млн руб.; VPUB ${format(point.metrics.vpub_mrub_per_year)} синтет. млн руб./год.` }).join(' ') : 'Других допустимых вариантов при этих условиях нет.' },
    { title: 'Главный компромисс', text: difference(explanation.main_compromise_against_runner_up, catalog) },
    { title: 'Официальный STRESS', text: `Для выбранного состава: ${candidate.scenarios.STRESS.status}. Лимит ${format(catalog.scenarios.BASE.c0_max_mrub)} → ${format(catalog.scenarios.STRESS.c0_max_mrub)} млн руб.; запас ${format(candidate.scenarios.BASE.c0_margin)} → ${format(candidate.scenarios.STRESS.c0_margin)} млн руб. Стоимость одного состава не меняется. ${candidate.scenarios.STRESS.ok ? 'Состав допустим в официальном STRESS.' : 'Этот состав не проходит официальный STRESS; требуется отдельный официальный стресс-ответ.'}` },
  ]
  if (value.context === 'RESEARCH') rows.push({ title: 'Граница устойчивости', text: `Свой лимит, не сценарий организаторов. Исследуемый исходный состав ${composition(value.current.candidate.selection)}: граница C0 ${value.budget.current_breakpoint} млн руб.; текущий лимит ${value.budget.cap}. Минимум с текущими обязательными сервисами ${value.budget.minimum_feasible_budget ?? 'отсутствует'} млн руб. Численный допуск ${value.budget.eps}. Граница проверяет C0; остальные условия и обязательные сервисы обязательны.` })
  rows.push(
    { title: 'Финансирование', text: `CALCULATED: C0 ${format(totals.c0_mrub)} млн руб. при запуске; OPEX ${format(totals.opex_mrub_per_year)}, якорный ${format(totals.anchor_cash_mrub_per_year)}, коммерческий ${format(totals.commercial_cash_mrub_per_year)}, CASH ${format(totals.cash_mrub_per_year)} млн руб./год. VPUB отдельно от денег. Портфельный дефицит ${format(totals.portfolio_funding_gap)}, сумма адресных дефицитов ${format(totals.sum_lot_funding_gaps)} млн руб./год. ${passport.services.map(service => `${service.lot_id} ${service.mode_id}: ${service.chain[0].provenance} — ${service.chain[0].text}; адресный дефицит ${format(service.finance.lot_funding_gap)}.`).join(' ')}` },
    { title: 'Главная уязвимость', text: `Сумма адресных дефицитов сервисов ${format(candidate.sum_lot_funding_gaps)} млн руб./год; нулевой портфельный дефицит не подтверждает их покрытие. Финансирование запуска и коммерческие обязательства не подтверждены.` },
    { title: 'Условия реального внедрения', text: `${explanation.unconfirmed_conditions.join(' ')} Фактический спрос, ликвидность, права, SLA, KPI baseline и достигнутые KPI не подтверждены. Для несовпадающих lot/mode паспорт показывает UNKNOWN.` },
    { title: 'Что контролировать дальше', text: 'Предложение команды: до пилота согласовать плательщика, получателя, предмет договора и права; обеспечить адресное покрытие дефицита; измерить локальное качество и baseline KPI; затем контролировать C0 относительно лимита, OPEX, договорный CASH и качество сервиса. VPUB учитывать отдельно. Решение о внедрении условное, после проверки этих условий.' },
  )
  return rows
}

export function Brief({ value, catalog, pendingContext }: {
  value?: Intelligence; catalog: Catalog; pendingContext?: string
}) {
  const request: RequestInput | undefined = value?.recommendation ? value.recommendation.request : undefined
  const passport = usePassport(request)
  const [openedKey, setOpenedKey] = useState('')
  const key = value && passport.data ? JSON.stringify([value.input_fingerprint, passport.data.active_sources]) : ''
  const ready = !!value?.recommendation && !!value.explanation && !!passport.data && !pendingContext
  const rows = ready ? briefSections(value!, passport.data!, catalog) : []
  const open = !!key && key === openedKey && ready
  const markdown = () => '# KOSMOS · Карточка решения\n\n' + rows.map((row, index) => `## ${index + 1}. ${row.title}\n\n${row.text}`).join('\n\n')
    + '\n\nКонтекст и происхождение:\n\n```json\n' + JSON.stringify({
      context: value!.context, scenario: value!.active_scenario, budget_cap: value!.budget.cap,
      ranking: value!.ranking_context, locks: value!.locks, sources: passport.data!.active_sources,
    }, null, 2) + '\n```\n'

  return <Block title="Карточка решения" note="собирается из текущего расчёта: рекомендация, альтернативы, компромисс, стресс и условия запуска"
    actions={<>
      <button type="button" className="primary" disabled={!ready} onClick={() => setOpenedKey(key)}>Собрать карточку</button>
      {open && <button type="button" onClick={() => download(markdown(), 'kosmos-decision-brief.md', 'text/markdown;charset=utf-8')}>Скачать · Markdown</button>}
    </>}>
    <Facts className="facts-row">
      <Fact label="Контекст расчёта" value={pendingContext ? `${pendingContext} · ожидаем данные` : value ? `${value.context} / ${value.active_scenario}` : 'ожидаем расчёт'} />
      <Fact label="Обязательные сервисы" value={value ? value.locks.map(lock => `${lock.lot_id} ${lock.mode_id || 'любой режим'}`).join(' · ') || 'не заданы' : '—'} />
    </Facts>
    {value?.status === 'NO_SOLUTION' && <Callout tone="warn">Допустимого решения нет: карточка с рекомендацией недоступна. Измените лимит или обязательные сервисы в корректировке бюджета.</Callout>}
    {passport.error && <Callout tone="error" role="alert">{passport.error} <button type="button" className="link" onClick={passport.retry}>Повторить</button></Callout>}
    {!ready && !passport.error && value?.recommendation && <Callout tone="note" role="status">Проверяем паспорт именно этой рекомендации…</Callout>}
    {open && <Disclosure summary="Содержание карточки" note={`${rows.length} разделов`} open>
      <ol className="brief-sections">{rows.map(row => <li key={row.title}>
        <h3 className="object-title">{row.title}</h3>
        <p>{row.text}</p>
      </li>)}</ol>
    </Disclosure>}
  </Block>
}
