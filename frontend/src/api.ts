export async function api<T>(path: string, body?: string | Blob, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body, signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Нет связи с локальным сервером. Проверьте запуск приложения и повторите расчёт.')
  }
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch {
    throw new Error('Сервер вернул нечитаемый ответ. Проверьте локальный запуск и повторите расчёт.')
  }
  if (!response.ok) {
    const details = data.error?.issues?.map((item: { location: (string | number)[]; message: string }) => `${item.location.join('.')}: ${item.message}`).join('; ')
    throw new Error([data.error?.message || `Ошибка сервера (${response.status}).`, details].filter(Boolean).join(' '))
  }
  return data as T
}

export function download(text: string, name: string, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
