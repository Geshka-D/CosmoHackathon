import type { Scalar } from './types'

export const lotNames: Record<string, string> = {
  FIRE: 'Лесные пожары', FLOOD: 'Паводки и оползни', AGRI: 'Агроаналитика', INFRA: 'Деформации инфраструктуры',
  ARCTIC: 'Удалённая логистика', TRANS: 'Транспорт', ENV: 'Экологический мониторинг', SSA: 'Космическая обстановка',
}
export const metricNames: Record<string, string> = {
  c0_mrub: 'C0 · запуск', opex_mrub_per_year: 'OPEX · эксплуатация', vpub_mrub_per_year: 'VPUB · общественная ценность',
  cash_mrub_per_year: 'CASH · денежный поток', kcash: 'KCASH · денежное покрытие',
  anchor_cash_mrub_per_year: 'Якорный CASH', commercial_cash_mrub_per_year: 'Коммерческий CASH',
  t_rep: 'Заданный индекс t_rep', readiness_1_5: 'Готовность', resilience_1_5: 'Устойчивость', scale_1_5: 'Масштабируемость',
  selected_lots: 'Состав', territorial_archetypes: 'Территориальные архетипы', capability_groups: 'Группы возможностей',
  capability_set: 'Возможности', public_core_lots: 'Общественное ядро',
}
/** Human name first, technical code second: the code is a badge, never the heading. */
export const metricHuman: Record<string, string> = {
  c0_mrub: 'Стартовые затраты', opex_mrub_per_year: 'Годовая эксплуатация', vpub_mrub_per_year: 'Общественная ценность',
  cash_mrub_per_year: 'Денежный поток', kcash: 'Денежное покрытие', anchor_cash_mrub_per_year: 'Якорный поток',
  commercial_cash_mrub_per_year: 'Коммерческий поток', t_rep: 'Заданный индекс', readiness_1_5: 'Готовность',
  resilience_1_5: 'Устойчивость', scale_1_5: 'Масштабируемость',
  territorial_archetypes: 'Территориальные архетипы', capability_groups: 'Группы возможностей', public_core_lots: 'Общественное ядро',
}
export const metricCode: Record<string, string> = {
  c0_mrub: 'C0', opex_mrub_per_year: 'OPEX', vpub_mrub_per_year: 'VPUB', cash_mrub_per_year: 'CASH', kcash: 'KCASH',
  anchor_cash_mrub_per_year: 'anchor CASH', commercial_cash_mrub_per_year: 'commercial CASH', t_rep: 't_rep',
  readiness_1_5: 'readiness', resilience_1_5: 'resilience', scale_1_5: 'scale',
}
/** Short human names for dense table headings: still a name, never only a code. */
export const metricShort: Record<string, string> = {
  c0_mrub: 'Старт', opex_mrub_per_year: 'Эксплуатация', vpub_mrub_per_year: 'Ценность',
  cash_mrub_per_year: 'Поток', kcash: 'Покрытие', anchor_cash_mrub_per_year: 'Якорный',
  commercial_cash_mrub_per_year: 'Коммерческий', t_rep: 'Индекс', readiness_1_5: 'Готовность',
  resilience_1_5: 'Устойчивость', scale_1_5: 'Масштаб',
}
/** One shared vocabulary for the eight weighted criteria; the panels must not disagree. */
export const criterionNames: Record<string, string> = {
  vpub: 'общественная ценность', c0: 'стартовые затраты', opex: 'эксплуатация', kcash: 'денежное покрытие',
  t_rep: 'индекс t_rep', readiness: 'готовность', resilience: 'устойчивость', scale: 'масштабируемость',
}
/** Short hints reused by metric tooltips instead of a paragraph next to every number. */
export const metricHints: Record<string, string> = {
  c0_mrub: 'Единовременные стартовые затраты состава, млн ₽ при запуске.',
  opex_mrub_per_year: 'Годовая эксплуатация состава, млн ₽/год.',
  vpub_mrub_per_year: 'Синтетическая общественная ценность кейса. Не деньги и не источник покрытия OPEX.',
  cash_mrub_per_year: 'Якорный + коммерческий денежный поток, млн ₽/год.',
  kcash: 'Отношение сумм CASH/OPEX. Не прибыльность и не окупаемость.',
  t_rep: 'Безразмерный индекс кейса. Расшифровка не задана, это не окупаемость.',
}
export const mainMetrics = ['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash']
export const indexMetrics = ['t_rep', 'readiness_1_5', 'resilience_1_5', 'scale_1_5']
export const compareMetrics = [...mainMetrics, 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year', ...indexMetrics, 'territorial_archetypes', 'capability_groups', 'public_core_lots']

/** Display units of the product: one currency spelling everywhere in the interface.
 *  Server unit strings stay verbatim inside provenance and technical tables. */
const UNITS: Record<string, string> = {
  c0_mrub: 'млн ₽', opex_mrub_per_year: 'млн ₽/год', vpub_mrub_per_year: 'синт. млн ₽/год',
  cash_mrub_per_year: 'млн ₽/год', anchor_cash_mrub_per_year: 'млн ₽/год', commercial_cash_mrub_per_year: 'млн ₽/год',
  kcash: '', t_rep: '', readiness_1_5: '1–5', resilience_1_5: '1–5', scale_1_5: '1–5',
}
export const unitOf = (field: string) => UNITS[field] ?? ''
export function format(value: Scalar | undefined, digits = 3): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value !== 'number') return value
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
}
/** Signed difference. Three digits by default: the interface reads deltas, the
 *  provenance tables ask for full precision explicitly. */
export function signed(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' && value > 0 ? `+${format(value, digits)}` : format(value, digits)
}
/** Money for the interface: value and unit in one visual line. */
export const money = (value: Scalar | undefined, unit = 'млн ₽', digits = 1) => `${format(value, digits)} ${unit}`
