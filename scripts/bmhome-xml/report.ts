import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export type SyncTotals = {
  productsFound: number
  productsParsed: number
  variantsFound: number
  variantsParsed: number
  created: number
  updated: number
  unchanged: number
  deactivated: number
  hiddenNoPriceCount: number
  priceOnRequestCount: number
  errorsCount: number
}

export type PriceChange = {
  productCode: string
  oldPrice: string
  newPrice: string
}

export type ErrorEntry = {
  timestamp: string
  message: string
  stack?: string
  url?: string
  productCode?: string
  context?: Record<string, unknown>
}

export type SyncReport = {
  startedAt: string
  finishedAt: string
  durationMs: number
  config: Record<string, unknown>
  totals: SyncTotals
  priceChanged: PriceChange[]
  topErrors: ErrorEntry[]
  noteRu?: string
}

export type Reporter = {
  runDir: string
  logPath: string
  errorsPath: string
  log: (message: string) => void
  writeError: (entry: ErrorEntry) => void
  writeReport: (report: SyncReport) => void
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function formatLogTime(date: Date): string {
  return `${date.toISOString()}`
}

function formatMarkdown(report: SyncReport): string {
  const lines: string[] = []
  lines.push(`# BMHOME XML sync report`)
  lines.push('')
  lines.push(`Started: ${report.startedAt}`)
  lines.push(`Finished: ${report.finishedAt}`)
  lines.push(`Duration: ${Math.round(report.durationMs / 1000)}s`)
  lines.push('')
  lines.push('## Totals')
  const pricedCount = Math.max(
    0,
    report.totals.productsParsed -
      report.totals.deactivated -
      report.totals.hiddenNoPriceCount -
      report.totals.priceOnRequestCount
  )
  lines.push(`- Products found: ${report.totals.productsFound}`)
  lines.push(`- Products parsed: ${report.totals.productsParsed}`)
  lines.push(`- Variants found: ${report.totals.variantsFound}`)
  lines.push(`- Variants parsed: ${report.totals.variantsParsed}`)
  lines.push(`- Created: ${report.totals.created}`)
  lines.push(`- Updated: ${report.totals.updated}`)
  lines.push(`- Unchanged: ${report.totals.unchanged}`)
  lines.push(`- Deactivated: ${report.totals.deactivated}`)
  lines.push(`- Priced: ${pricedCount}`)
  lines.push(`- Price on request: ${report.totals.priceOnRequestCount}`)
  lines.push(`- Hidden (no price): ${report.totals.hiddenNoPriceCount}`)
  lines.push(`- Errors: ${report.totals.errorsCount}`)
  lines.push('')
  if (report.noteRu) {
    lines.push('## Примечание')
    lines.push(`- ${report.noteRu}`)
    lines.push('')
  }
  lines.push('## Price changes')
  if (report.priceChanged.length === 0) {
    lines.push('- none')
  } else {
    for (const change of report.priceChanged) {
      lines.push(`- ${change.productCode}: ${change.oldPrice} -> ${change.newPrice}`)
    }
  }
  lines.push('')
  lines.push('## Top errors')
  if (report.topErrors.length === 0) {
    lines.push('- none')
  } else {
    for (const error of report.topErrors) {
      const location = error.url ? ` (${error.url})` : ''
      lines.push(`- ${error.message}${location}`)
    }
  }
  lines.push('')
  return lines.join(os.EOL)
}

export function createReporter(reportDir: string, config: Record<string, unknown>): Reporter {
  const baseDir = path.resolve(process.cwd(), reportDir)
  fs.mkdirSync(baseDir, { recursive: true })
  const runDir = path.join(baseDir, formatTimestamp(new Date()))
  fs.mkdirSync(runDir, { recursive: true })

  const logPath = path.join(runDir, 'run.log')
  const errorsPath = path.join(runDir, 'errors.jsonl')

  fs.writeFileSync(logPath, '')
  fs.writeFileSync(errorsPath, '')

  const log = (message: string) => {
    const line = `[${formatLogTime(new Date())}] ${message}`
    fs.appendFileSync(logPath, `${line}${os.EOL}`)
    console.log(line)
  }

  const writeError = (entry: ErrorEntry) => {
    fs.appendFileSync(errorsPath, `${JSON.stringify(entry)}${os.EOL}`)
  }

  const writeReport = (report: SyncReport) => {
    const jsonPath = path.join(runDir, 'report.json')
    const mdPath = path.join(runDir, 'report.md')
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
    fs.writeFileSync(mdPath, formatMarkdown(report))
  }

  log(`Report directory: ${runDir}`)
  log(`Config: ${JSON.stringify(config)}`)

  return {
    runDir,
    logPath,
    errorsPath,
    log,
    writeError,
    writeReport,
  }
}
