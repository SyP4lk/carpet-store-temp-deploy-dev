'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type SyncSettings = {
  catalogMode: 'AUTO' | 'DEFAULT_ONLY' | 'BMHOME_ONLY' | 'MERGE'
  autoFallbackMinCount: number
  feedUrl: string
  usdToEurRate: number
}

type SyncRun = {
  id: number
  status: 'RUNNING' | 'SUCCESS' | 'NEED_AUTH' | 'FAILED'
  startedAt: string
  finishedAt?: string | null
  productsFound: number
  productsParsed: number
  variantsFound: number
  variantsParsed: number
  created: number
  updated: number
  unchanged: number
  deactivated: number
  hiddenNoPrice: number
  hiddenZeroPrice: number
  errorsCount: number
  summaryRu?: string | null
  hintRu?: string | null
  reportDir?: string | null
  reportJsonPath?: string | null
  reportMdPath?: string | null
}

type StatusResponse = {
  settings: SyncSettings
  bmhomeCount: number
  resolvedSource: 'DEFAULT' | 'BMHOME' | 'MERGE'
  lastRun?: SyncRun | null
  eurToRubRate: number
  warningRu?: string | null
}

const statusLabels: Record<SyncRun['status'], string> = {
  RUNNING: 'В процессе',
  SUCCESS: 'Успешно',
  NEED_AUTH: 'Нужно подтверждение',
  FAILED: 'Ошибка',
}

const statusColors: Record<SyncRun['status'], string> = {
  RUNNING: 'text-blue-600',
  SUCCESS: 'text-green-600',
  NEED_AUTH: 'text-amber-600',
  FAILED: 'text-red-600',
}

const catalogModeLabels: Record<SyncSettings['catalogMode'], string> = {
  AUTO: 'AUTO',
  DEFAULT_ONLY: 'Только дефолтные',
  BMHOME_ONLY: 'Только BMHOME',
  MERGE: 'Вместе',
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU')
}

export default function BmhomeSyncPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SyncSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trMode, setTrMode] = useState<'translate' | 'copy_en'>('translate')
  const [trDesc, setTrDesc] = useState(true)
  const [trTech, setTrTech] = useState(true)
  const [trLists, setTrLists] = useState(true)
  const [trTaxonomy, setTrTaxonomy] = useState(false)
  const [translateRunning, setTranslateRunning] = useState(false)
  const [translateMessage, setTranslateMessage] = useState<string | null>(null)
  const [translateError, setTranslateError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    const response = await fetch('/api/admin/bmhome-sync/status', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Не удалось загрузить статус синхронизации')
    }
    const data = (await response.json()) as StatusResponse
    setStatus(data)
    setSettingsDraft(data.settings)
    setRunning(data.lastRun?.status === 'RUNNING')
  }, [])

  const loadRuns = useCallback(async () => {
    const response = await fetch('/api/admin/bmhome-sync/runs', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Не удалось загрузить историю запусков')
    }
    const data = await response.json()
    setRuns(data.runs ?? [])
  }, [])

  const reloadAll = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      await Promise.all([loadStatus(), loadRuns()])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [loadStatus, loadRuns])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  const startSync = async () => {
    try {
      setStarting(true)
      const response = await fetch('/api/admin/bmhome-sync/run', { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Не удалось запустить синхронизацию')
      }
      await reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка запуска синхронизации')
    } finally {
      setStarting(false)
    }
  }

  const startTranslate = async () => {
    try {
      setTranslateRunning(true)
      setTranslateMessage(null)
      setTranslateError(null)
      const response = await fetch('/api/admin/bmhome-sync/translate-ru', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: trMode,
          translateDescriptions: trDesc,
          translateTechnicalDetails: trTech,
          translateLists: trLists,
          translateTaxonomy: trTaxonomy,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось запустить перевод')
      }
      const logInfo = data?.logFile ? ` (${data.logFile})` : ''
      setTranslateMessage(`Перевод запущен${logInfo}`)
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Ошибка запуска перевода')
    } finally {
      setTranslateRunning(false)
    }
  }


  const saveSettings = async () => {
    if (!settingsDraft) return
    try {
      setSaving(true)
      const response = await fetch('/api/admin/bmhome-sync/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsDraft),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Не удалось сохранить настройки')
      }
      await reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения настроек')
    } finally {
      setSaving(false)
    }
  }

  const lastRun = status?.lastRun
  const priceOnRequestCount = lastRun?.hiddenZeroPrice ?? 0
  const hiddenNoPriceCount = lastRun?.hiddenNoPrice ?? 0
  const pricedCount = lastRun
    ? Math.max(0, (lastRun.productsParsed ?? 0) - (lastRun.deactivated ?? 0) - hiddenNoPriceCount - priceOnRequestCount)
    : 0
  const resolvedSourceLabel = useMemo(() => {
    if (!status) return '—'
    if (status.resolvedSource === 'MERGE') return 'Дефолтные + BMHOME'
    if (status.resolvedSource === 'DEFAULT') return 'Дефолтные'
    return 'BMHOME'
  }, [status])

  const makeReportLink = (runId: number, type: 'md' | 'json' | 'log') =>
    `/api/admin/bmhome-sync/report?runId=${runId}&type=${type}`

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">BMHOME XML синхронизация</h2>
            <p className="text-sm text-gray-500">
              Синхронизация каталога из официального Ticimax XML фида.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={startSync}
              disabled={running || starting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {running || starting ? 'Синхронизация запущена...' : 'Run sync now'}
            </button>
            <button
              onClick={reloadAll}
              disabled={loading}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Обновить
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-2">
            {error}
          </div>
        )}

        {status?.warningRu && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-md px-4 py-2">
            {status.warningRu}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Статус</p>
            <p className={`text-lg font-semibold ${lastRun ? statusColors[lastRun.status] : 'text-gray-700'}`}>
              {lastRun ? statusLabels[lastRun.status] : 'Нет данных'}
            </p>
            <p className="text-sm text-gray-500 mt-1">Старт: {formatDate(lastRun?.startedAt)}</p>
            <p className="text-sm text-gray-500">Финиш: {formatDate(lastRun?.finishedAt)}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Каталог сейчас</p>
            <p className="text-lg font-semibold text-gray-900">{resolvedSourceLabel}</p>
            <p className="text-sm text-gray-500 mt-1">BMHOME товаров: {status?.bmhomeCount ?? 0}</p>
            <p className="text-sm text-gray-500">Курс EUR → RUB: {status ? status.eurToRubRate.toFixed(2) : '—'}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Итог</p>
            <p className="text-sm text-gray-700">{lastRun?.summaryRu || '—'}</p>
            {lastRun?.hintRu && <p className="text-sm text-gray-500 mt-1">{lastRun.hintRu}</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Товары</p>
            <p className="text-lg font-semibold text-gray-900">{lastRun?.productsParsed ?? 0}</p>
            <p className="text-sm text-gray-500">Найдено: {lastRun?.productsFound ?? 0}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Варианты</p>
            <p className="text-lg font-semibold text-gray-900">{lastRun?.variantsParsed ?? 0}</p>
            <p className="text-sm text-gray-500">Найдено: {lastRun?.variantsFound ?? 0}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Изменения</p>
            <p className="text-lg font-semibold text-gray-900">
              {lastRun ? `${lastRun.created}/${lastRun.updated}` : '0/0'}
            </p>
            <p className="text-sm text-gray-500">Деактивировано: {lastRun?.deactivated ?? 0}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-xs uppercase text-gray-400">Visibility</p>
            <p className="text-sm text-gray-700">Priced: {pricedCount}</p>
            <p className="text-sm text-gray-700">Price on request: {priceOnRequestCount}</p>
            <p className="text-sm text-gray-700">Hidden: {hiddenNoPriceCount}</p>
            <p className="text-sm text-gray-500">Deactivated: {lastRun?.deactivated ?? 0}</p>
            <p className="text-sm text-gray-500">Errors: {lastRun?.errorsCount ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Настройки</h3>
          <p className="text-sm text-gray-500">
            URL XML фида и режим показа каталога.
          </p>
          <p className="text-sm text-gray-500 mt-1">
            AUTO: если товаров BMHOME меньше autoFallbackMinCount, витрина показывает дефолтный каталог.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            Feed URL
            <input
              type="url"
              value={settingsDraft?.feedUrl ?? ''}
              onChange={(event) =>
                setSettingsDraft((prev) => (prev ? { ...prev, feedUrl: event.target.value } : prev))
              }
              className="mt-2 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm text-gray-700">
            USD → EUR (rate)
            <input
              type="number"
              min={0}
              step={0.0001}
              value={settingsDraft?.usdToEurRate ?? 1}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev ? { ...prev, usdToEurRate: Number(event.target.value) } : prev
                )
              }
              className="mt-2 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            Показывать товары
            <select
              value={settingsDraft?.catalogMode ?? 'AUTO'}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev
                    ? { ...prev, catalogMode: event.target.value as SyncSettings['catalogMode'] }
                    : prev
                )
              }
              className="mt-2 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {Object.entries(catalogModeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Минимум товаров для AUTO
            <input
              type="number"
              min={1}
              value={settingsDraft?.autoFallbackMinCount ?? 1}
              onChange={(event) =>
                setSettingsDraft((prev) =>
                  prev ? { ...prev, autoFallbackMinCount: Number(event.target.value) } : prev
                )
              }
              className="mt-2 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Перевод RU</h3>
          <p className="text-sm text-gray-500">
            Выберите режим и что переводить. Запуск в фоне, лог пишется в /logs.
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Режим</p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="translate-mode"
                value="translate"
                checked={trMode === 'translate'}
                onChange={() => setTrMode('translate')}
              />
              Показывать перевод (RU)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="translate-mode"
                value="copy_en"
                checked={trMode === 'copy_en'}
                onChange={() => setTrMode('copy_en')}
              />
              Показывать оригинал EN (копировать EN → RU)
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Что переводить</p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={trDesc} onChange={(e) => setTrDesc(e.target.checked)} />
              Descriptions / shortHtml
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={trTech} onChange={(e) => setTrTech(e.target.checked)} />
              Technical details
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={trLists} onChange={(e) => setTrLists(e.target.checked)} />
              CARE AND WARRANTY / TECHNICAL INFORMATION
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={trTaxonomy} onChange={(e) => setTrTaxonomy(e.target.checked)} />
              Taxonomy (collection / style / color)
            </label>
          </div>
        </div>
        {translateError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-4 py-2">
            {translateError}
          </div>
        )}
        {translateMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-md px-4 py-2">
            {translateMessage}
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={startTranslate}
            disabled={translateRunning}
            className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {translateRunning ? 'Перевод запущен...' : 'Запустить перевод RU'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">История запусков</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">Старт</th>
                <th className="py-2 pr-4">Статус</th>
                <th className="py-2 pr-4">Товары</th>
                <th className="py-2 pr-4">Варианты</th>
                <th className="py-2 pr-4">Создано/Обновлено/Деакт.</th>
                <th className="py-2 pr-4">Ошибки</th>
                <th className="py-2 pr-4">Отчет</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-gray-500">
                    Запусков пока нет.
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="border-b">
                  <td className="py-2 pr-4 text-gray-700">{run.id}</td>
                  <td className="py-2 pr-4 text-gray-700">{formatDate(run.startedAt)}</td>
                  <td className={`py-2 pr-4 font-medium ${statusColors[run.status]}`}>
                    {statusLabels[run.status]}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">
                    {run.productsParsed}/{run.productsFound}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">
                    {run.variantsParsed}/{run.variantsFound}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">
                    {run.created}/{run.updated}/{run.deactivated}
                  </td>
                  <td className="py-2 pr-4 text-gray-700">{run.errorsCount}</td>
                  <td className="py-2 pr-4 text-gray-600">
                    {run.reportMdPath ? (
                      <div className="flex gap-2">
                        <a
                          href={makeReportLink(run.id, 'md')}
                          className="text-blue-600 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          report.md
                        </a>
                        <a
                          href={makeReportLink(run.id, 'log')}
                          className="text-blue-600 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          run.log
                        </a>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
