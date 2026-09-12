/** Schematic axonometric view of the chosen portfolio: services → public core or paid
 *  layer → territories and users. Pure SVG, no WebGL and no library. Every label is a
 *  field of the saved case (lots.csv, access_modes.csv, service-design M0); there are no
 *  coordinates, orbits, satellites, coverage or telemetry anywhere in this drawing. */
import { useState } from 'react'
import { format, lotNames, money } from './presentation'
import { Disclosure, Fact, Facts, Tip } from './ui'
import type { Candidate, ServiceContext } from './decision'
import type { Catalog, Lot } from './types'

const U = 54, LEVEL = 94, SPAN = 1.5, START = 0.75
const iso = (x: number, y: number, level: number) => ({ x: (x - y) * 0.866 * U, y: (x + y) * 0.5 * U - level * LEVEL })
const planePath = (level: number) => [[0, 0], [6, 0], [6, 2], [0, 2]]
  .map(([x, y]) => iso(x, y, level)).map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ') + ' Z'

type MapRow = { index: number; lot_id: string; mode_id: string; lot?: Lot; service?: ServiceContext; core: boolean }

function Link({ row, on }: { row: MapRow; on: boolean }) {
  const top = iso(START + row.index * SPAN, 1, 2)
  const middle = iso(row.core ? 1.5 : 4.5, 1, 1)
  const bottom = iso(START + row.index * SPAN, 1, 0)
  return <g className={`map-link ${row.core ? 'core' : 'paid'} ${on ? 'on' : ''}`}>
    <path d={`M${top.x} ${top.y} L${middle.x} ${middle.y} L${bottom.x} ${bottom.y}`} />
  </g>
}

export function ServiceMap({ candidate, services, catalog }: { candidate: Candidate; services: ServiceContext[]; catalog: Catalog }) {
  const [selected, setSelected] = useState<string>(candidate.selection[0]?.lot_id || '')
  const rows: MapRow[] = candidate.selection.map((row, index) => {
    const lot = catalog.lots.find(item => item.lot_id === row.lot_id) as Lot | undefined
    const service = services.find(item => item.lot_id === row.lot_id)
    return { index, lot_id: row.lot_id, mode_id: row.mode_id, lot, service, core: candidate.public_core_ids.includes(row.lot_id) }
  })
  const active = rows.find(row => row.lot_id === selected) || rows[0]
  const coreCount = rows.filter(row => row.core).length

  return <div className="map">
    <div className="map-figure">
      <svg viewBox="-205 -215 530 435" className="map-svg" role="group" aria-label="Схема портфеля: сервисы, слой финансирования, территории">
        <title>Условная схема выбранного портфеля</title>
        {[0, 1, 2].map(level => <path key={level} className="map-plane" d={planePath(level)} />)}

        {rows.filter(row => row.lot_id !== selected).map(row => <Link key={`link-${row.lot_id}`} row={row} on={false} />)}

        {([[1.5, 'Общественное ядро', coreCount], [4.5, 'Платный слой', rows.length - coreCount]] as const).map(([x, label, count]) => {
          const point = iso(x, 1, 1)
          const lit = !!active && ((x < 3) === active.core)
          return <g key={label} className={`map-zone ${x < 3 ? 'core' : 'paid'} ${lit ? 'on' : ''}`}>
            <ellipse cx={point.x} cy={point.y} rx={70} ry={36} />
            <text x={point.x} y={point.y - 2} textAnchor="middle">{label}</text>
            <text x={point.x} y={point.y + 14} textAnchor="middle" className="map-zone-count">{count} из {rows.length}</text>
          </g>
        })}

        {rows.filter(row => row.lot_id === selected).map(row => <Link key={`link-on-${row.lot_id}`} row={row} on />)}

        {rows.map(row => {
          const point = iso(START + row.index * SPAN, 1, 2)
          return <g key={row.lot_id} className={`map-node ${selected === row.lot_id ? 'on' : ''} ${row.core ? 'core' : 'paid'}`}
            role="button" tabIndex={0} aria-pressed={selected === row.lot_id}
            aria-label={`${row.lot_id}, ${lotNames[row.lot_id]}, режим ${row.mode_id}, ${row.core ? 'общественное ядро' : 'платный слой'}`}
            onClick={() => setSelected(row.lot_id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row.lot_id) } }}>
            <rect x={point.x - 31} y={point.y - 52} width={62} height={42} rx={2} />
            <text x={point.x} y={point.y - 34} textAnchor="middle" className="map-node-id">{row.lot_id}</text>
            <text x={point.x} y={point.y - 19} textAnchor="middle" className="map-node-mode">режим {row.mode_id}</text>
            <line x1={point.x} y1={point.y - 10} x2={point.x} y2={point.y} />
          </g>
        })}

        {rows.map(row => {
          const point = iso(START + row.index * SPAN, 1, 0)
          return <g key={`t-${row.lot_id}`} className={`map-territory ${selected === row.lot_id ? 'on' : ''}`}>
            <circle cx={point.x} cy={point.y} r={5} />
            <text x={point.x} y={point.y + 20} textAnchor="middle">{row.lot?.federal ? 'федеральный' : String(row.lot?.territorial_archetype ?? '—')}</text>
          </g>
        })}

        <text className="map-level" x={iso(0, 2, 2).x - 12} y={iso(0, 2, 2).y} textAnchor="end">Сервисы</text>
        <text className="map-level" x={iso(0, 2, 1).x - 12} y={iso(0, 2, 1).y} textAnchor="end">Кто платит</text>
        <text className="map-level" x={iso(0, 2, 0).x - 12} y={iso(0, 2, 0).y} textAnchor="end">Территории</text>
      </svg>
      <p className="map-caveat">Схема связей, не географическая карта.
        <Tip label="Что показывает схема">Условная схема по сохранённым данным кейса: это не зона покрытия, не орбиты и не число спутников.
          «Территория» — территориальный архетип лота из lots.csv; федеральный лот не добавляет архетип в счёт.</Tip>
      </p>
    </div>

    <div className="map-readout" aria-live="polite">
      <div className="map-tabs" role="group" aria-label="Выбрать лот портфеля">
        {rows.map(row => <button key={row.lot_id} type="button" aria-pressed={selected === row.lot_id}
          className={selected === row.lot_id ? 'on' : ''} onClick={() => setSelected(row.lot_id)}>{row.lot_id} {row.mode_id}</button>)}
      </div>
      {active && <>
        <p className="object-role">{active.core ? 'Общественное ядро' : 'Платный слой'}</p>
        <p className="object-title">{active.lot_id} {active.mode_id}</p>
        <p className="object-meta">{lotNames[active.lot_id]}</p>
        <Facts>
          <Fact label="Режим доступа" value={`${active.mode_id} · ${active.core ? 'засчитывается в общественное ядро' : 'вне общественного ядра'}`} />
          <Fact label="Территория" value={`${String(active.lot?.territorial_archetype ?? '—')}${active.lot?.federal ? ' · федеральный' : ''}`} />
          <Fact label="Возможности" value={String(active.lot?.capability_groups ?? '—')} />
          <Fact label="Стартовые затраты лота" code="C0" value={money(active.lot?.c0_mrub)} />
          <Fact label="Эксплуатация лота" code="OPEX" value={money(active.lot?.opex_mrub_per_year, 'млн ₽/год')} />
        </Facts>
        {active.service && <>
          <Disclosure summary="О задаче сервиса">
            <p>{active.service.task_proposal}</p>
            <p className="meta">Предложение команды из service-design M0, а не утверждённый договор.</p>
          </Disclosure>
          <Disclosure summary="Технические параметры режима">
            <Facts className="facts-tight">{Object.entries(active.service.mode_coefficients).map(([key, value]) =>
              <Fact key={key} label={key} value={format(value)} />)}</Facts>
            <p className="meta">Режим меняет C0, OPEX, VPUB, якорный и коммерческий CASH одновременно; A не означает бесплатный сервис.</p>
          </Disclosure>
        </>}
      </>}
    </div>
  </div>
}
