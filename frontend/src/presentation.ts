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
export const mainMetrics = ['c0_mrub', 'opex_mrub_per_year', 'vpub_mrub_per_year', 'cash_mrub_per_year', 'kcash']
export const indexMetrics = ['t_rep', 'readiness_1_5', 'resilience_1_5', 'scale_1_5']
export const compareMetrics = [...mainMetrics, 'anchor_cash_mrub_per_year', 'commercial_cash_mrub_per_year', ...indexMetrics, 'territorial_archetypes', 'capability_groups', 'public_core_lots']
export function format(value: Scalar | undefined, digits = 3): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value !== 'number') return value
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
}
export function signed(value: number | null | undefined): string {
  return typeof value === 'number' && value > 0 ? `+${format(value, 6)}` : format(value, 6)
}
