/** Money and responsibility for one composition: what is paid once, what is paid every
 *  year, what public value is produced — and who is proposed to owe what. VPUB is never
 *  added to CASH and never pays OPEX. All figures come from /api/passport. */
import { useState } from 'react'
import { format, lotNames, money } from './presentation'
import { Block, Callout, Disclosure, Fact, Facts, Kpi, KpiRow, Tip } from './ui'
import type { Passport } from './intelligence'

const chainLabels = ['Кто финансирует', 'Кому', 'За что', 'Кто использует', 'Ожидаемый результат']

export function Finance({ value }: { value: Passport }) {
  const [selected, setSelected] = useState('')
  const service = value.services.find(item => item.lot_id === selected) || value.services[0]
  const totals = value.finance.totals
  return <div className="finance" data-testid="finance-flow">
    <KpiRow>
      <Kpi label="Запуск" code="C0" value={format(totals.c0_mrub, 1)} unit="млн ₽ однократно" />
      <Kpi label="Год эксплуатации" code="OPEX" value={format(totals.opex_mrub_per_year, 1)} unit="млн ₽/год" />
      <Kpi label="Денежный поток" code="CASH" value={format(totals.cash_mrub_per_year, 1)} unit="млн ₽/год"
        hint={`Якорный ${format(totals.anchor_cash_mrub_per_year, 1)} + коммерческий ${format(totals.commercial_cash_mrub_per_year, 1)} млн ₽/год.`} />
      <Kpi label="Общественная ценность" code="VPUB" tone="accent" value={format(totals.vpub_mrub_per_year, 1)} unit="синт. млн ₽/год"
        hint="Не платёж и не источник покрытия OPEX." />
    </KpiRow>

    <Facts className="facts-row">
      <Fact label="Портфельный дефицит" value={money(totals.portfolio_funding_gap, 'млн ₽/год')} />
      <Fact label="Сумма адресных дефицитов" tone={totals.sum_lot_funding_gaps > 0 ? 'stress' : 'plain'}
        value={money(totals.sum_lot_funding_gaps, 'млн ₽/год')}
        hint="Нулевой суммарный дефицит не разрешает переносить деньги между сервисами." />
      <Fact label="Финансирование запуска" tone="fail" value="не подтверждено" hint="UNKNOWN: обязательства по финансированию C0 не заявлены." />
    </Facts>
    <p className="meta">{value.interpretation}</p>

    <Block title="Ответственность по сервисам" note="предложенные роли из M4; подтверждённого плательщика или договора нет">
      <div className="service-tabs" role="group" aria-label="Сервис финансовой цепочки">
        {value.services.map(item => <button key={item.lot_id} type="button" aria-pressed={service.lot_id === item.lot_id}
          onClick={() => setSelected(item.lot_id)}>{item.lot_id} {item.mode_id}<small>{lotNames[item.lot_id]}</small></button>)}
      </div>

      <ol className="responsibility-chain">{service.chain.map((claim, index) => <li key={index} data-provenance={claim.provenance}>
        <span className="chain-label">{chainLabels[index]}</span>
        <p>{claim.text}</p>
        <small>{claim.provenance}</small>
      </li>)}</ol>

      <Facts>
        <Fact label={`Адресный дефицит ${service.lot_id} ${service.mode_id}`}
          tone={service.finance.lot_funding_gap > 0 ? 'stress' : 'plain'}
          value={money(service.finance.lot_funding_gap, 'млн ₽/год')} />
        <Fact label="Условие покрытия" value={service.gap_condition.text} />
        <Fact label={service.confirmed_contracts.provenance} value={service.confirmed_contracts.text} />
      </Facts>

      <Disclosure summary="Условия выбранного сервиса и происхождение">
        <Facts>{service.conditions.map((claim, index) => <Fact key={index} label={claim.provenance} value={claim.text} />)}</Facts>
        <pre>{JSON.stringify(value.active_sources, null, 2)}</pre>
      </Disclosure>
    </Block>
  </div>
}

/** Compact variant for the delivery screen: the figures without the service walk-through. */
export function FinanceTotals({ value }: { value: Passport }) {
  const totals = value.finance.totals
  return <Facts className="facts-row">
    <Fact label="Запуск" code="C0" value={money(totals.c0_mrub)} />
    <Fact label="Год эксплуатации" code="OPEX" value={money(totals.opex_mrub_per_year, 'млн ₽/год')} />
    <Fact label="Денежный поток" code="CASH" value={money(totals.cash_mrub_per_year, 'млн ₽/год')} />
    <Fact label="Адресные дефициты" value={money(totals.sum_lot_funding_gaps, 'млн ₽/год')} />
  </Facts>
}

export function FinanceUnavailable({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return <Callout tone={message ? 'error' : 'note'} role={message ? 'alert' : 'status'}>
    {message || 'Проверяем расчёт и активный паспорт рекомендации…'}
    {onRetry && message && <> <button type="button" className="link" onClick={onRetry}>Повторить</button></>}
    {!message && <Tip label="Что такое паспорт">Паспорт финансирования собирается для конкретного состава и режимов; для несовпадающих условия показываются как UNKNOWN.</Tip>}
  </Callout>
}
