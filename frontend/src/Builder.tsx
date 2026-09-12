/** Manual assembly of any composition. The calculation belongs to this screen because the
 *  portfolio here is a different object from the recommendation: it is computed separately
 *  and marked separately in the comparison. */
import { useRef, useState } from 'react'
import { ResultPanel } from './ResultPanel'
import { Finance } from './Finance'
import { usePassport } from './useEvidence'
import { format, lotNames, money } from './presentation'
import { Block, Callout, Disclosure, Fact, Facts, Tip, ViewHead } from './ui'
import type { Catalog, Envelope, ModeId, RequestInput, Scenario, Workspace } from './types'
import type { ViewId } from './routes'

export function Builder({ catalog, workspace, computed, busy, error, scenario, addReason, storage, rejected,
  onChangeName, onChangeSelection, onAdd, onExport, onImport, onUndo, onReset, onDownloadRejected, undoable, go }: {
  catalog: Catalog; workspace: Workspace; computed: Envelope['computed']; busy: boolean; error: string
  scenario: Scenario; addReason: string; storage: string; rejected: boolean
  onChangeName: (value: string) => void
  onChangeSelection: (index: number, lotId: string, modeId?: ModeId) => void
  onAdd: () => void; onExport: () => void; onImport: (file: File) => void
  onUndo: () => void; onReset: () => void; onDownloadRejected: () => void; undoable: boolean
  go: (view: ViewId, tab?: string) => void
}) {
  const upload = useRef<HTMLInputElement>(null)
  const [passport, setPassport] = useState(false)
  const request: RequestInput = workspace.current.request
  const complete = request.selection.length === 4
  const finance = usePassport(passport && complete ? request : undefined)
  const used = workspace.scenario

  return <>
    <ViewHead title="Конструктор портфеля"
      state={`${request.selection.length} из 4 позиций · лимит ${used} ${money(catalog.scenarios[used].c0_max_mrub)}`}
      actions={<>
        <button type="button" className="primary" disabled={busy || !computed || !!addReason} onClick={onAdd}>Добавить в сравнение</button>
        <button type="button" onClick={() => go('stress', 'own')}>Проверить стресс</button>
      </>} />

    {used !== scenario && <Callout tone="warn">Состав рассчитан по лимиту {used}, в заголовке выбран {scenario}. Переключите сценарий в заголовке, чтобы считать по одному условию.</Callout>}
    {addReason && <p className="meta">{addReason}</p>}

    <Block title="Состав" note="четыре позиции из восьми лотов; каждый лот можно выбрать один раз">
      <label className="name-field">Название текущего варианта
        <input maxLength={80} value={workspace.current.name} disabled={busy}
          onChange={event => onChangeName(event.target.value)} aria-invalid={!workspace.current.name.trim()} />
      </label>
      {!workspace.current.name.trim() && <p className="field-error">Введите название, чтобы сохранить и сравнить вариант.</p>}

      <div className="slots">{[0, 1, 2, 3].map(index => {
        const row = request.selection[index]
        const lot = catalog.lots.find(item => item.lot_id === row?.lot_id)
        const mode = catalog.modes.find(item => item.mode_id === row?.mode_id)
        return <fieldset className="slot" key={index} disabled={busy}>
          <legend>Позиция {index + 1}</legend>
          <label>Лот {index + 1}
            <select aria-label={`Лот ${index + 1}`} value={row?.lot_id || ''} disabled={!row && index > request.selection.length}
              onChange={event => onChangeSelection(index, event.target.value)}>
              <option value="">Выберите лот</option>
              {catalog.lots.map(item => <option key={item.lot_id} value={item.lot_id}
                disabled={request.selection.some((other, otherIndex) => otherIndex !== index && other.lot_id === item.lot_id)}>
                {item.lot_id} · {lotNames[item.lot_id]}</option>)}
            </select>
          </label>
          <label>Режим {index + 1}
            <select aria-label={`Режим ${index + 1}`} disabled={!row} value={row?.mode_id || 'A'}
              onChange={event => onChangeSelection(index, row.lot_id, event.target.value as ModeId)}>
              {catalog.modes.map(item => <option key={item.mode_id} value={item.mode_id}>
                {item.mode_id} · {item.public_core ? 'общественное ядро' : 'вне общественного ядра'}</option>)}
            </select>
          </label>
          {lot ? <Facts className="facts-tight slot-facts">
            <Fact label="Сервис" value={lot.service} />
            <Fact label="Территория" value={`${lot.territorial_archetype}${lot.federal ? ' · федеральный' : ''}`} />
            <Fact label="Возможности" value={lot.capability_groups} />
            <Fact label="Общественное ядро" tone={mode?.public_core ? 'pass' : 'plain'} value={mode?.public_core ? 'засчитывается' : 'не засчитывается'} />
          </Facts> : <p className="meta">Добавьте сервис из каталога.</p>}
        </fieldset>
      })}</div>
      <p className="meta">Только режим A засчитывается в общественное ядро; это не означает, что весь сервис бесплатен.
        <Tip label="Территориальный счёт">SSA исключается только из территориального счёта. PNT, InSAR и PNT/InSAR считаются одной группой возможностей.
          Федеральный лот не добавляет территориальный архетип.</Tip>
      </p>
    </Block>

    <Block title="Расчёт состава" note={`сценарий ${used}`}>
      {computed ? <ResultPanel result={computed.current} scenario={used} />
        : <Callout tone={error ? 'error' : 'note'} role={error ? 'alert' : 'status'}>
          {error ? 'Результаты скрыты до успешного пересчёта.' : busy ? 'Ожидаем завершения операции с JSON…' : 'Пересчитываем текущий ввод на сервере…'}
        </Callout>}
    </Block>

    {complete && <Block title="Паспорт финансирования этого состава"
      note="кто платит, за что и какой дефицит остаётся адресным"
      actions={<button type="button" className="quiet" onClick={() => setPassport(value => !value)}>{passport ? 'Скрыть паспорт' : 'Открыть паспорт'}</button>}>
      {!passport ? <p className="meta">Паспорт рассчитывается по запросу: для несовпадающих lot/mode условия показываются как UNKNOWN.</p>
        : finance.error ? <Callout tone="error" role="alert">{finance.error} <button type="button" className="link" onClick={finance.retry}>Повторить</button></Callout>
          : finance.data ? <Finance value={finance.data} />
            : <Callout tone="note" role="status">Проверяем активные M4/M5…</Callout>}
    </Block>}

    <Block title="Рабочая область" note="настройки сохраняются в этом браузере после успешного пересчёта">
      <p className="meta" role="status">{storage || 'Изменения сохраняются автоматически.'}</p>
      <div className="actions">
        <button type="button" className="quiet" disabled={busy || !computed} onClick={onExport}>Скачать JSON</button>
        <button type="button" className="quiet" disabled={busy} onClick={() => upload.current?.click()}>Импорт JSON</button>
        <input ref={upload} type="file" accept=".json,application/json" aria-label="Файл JSON для импорта" hidden
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onImport(file) }} />
        <button type="button" className="quiet" disabled={!undoable || busy} onClick={onUndo}>Отменить изменение</button>
        <button type="button" className="quiet" disabled={busy} onClick={onReset}>Сбросить всё</button>
        {rejected && <button type="button" className="quiet" onClick={onDownloadRejected}>Скачать прежнюю запись</button>}
      </div>
      <Disclosure summary="Сохранённые варианты" note={`${workspace.alternatives.length} из 3`}>
        {workspace.alternatives.length === 0 ? <p className="meta">Пока ничего не сохранено.</p>
          : <Facts>{workspace.alternatives.map(item => <Fact key={item.alternative_id} label={item.name}
            value={item.request.selection.map(row => `${row.lot_id} ${row.mode_id}`).join(' · ')} />)}</Facts>}
        <div className="actions"><button type="button" className="quiet" onClick={() => go('compare', 'saved')}>Открыть сравнение</button></div>
      </Disclosure>
      <p className="meta">Каталог: {catalog.case_id} · v{catalog.case_version} · {format(catalog.lots.length)} лотов.</p>
    </Block>
  </>
}
