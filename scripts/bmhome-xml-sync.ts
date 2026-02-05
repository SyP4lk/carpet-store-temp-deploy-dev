import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import sax from 'sax'
import { load } from 'cheerio'
import { BmhomeSyncStatus, PrismaClient, ProductSource } from '@prisma/client'
import { createReporter, type ErrorEntry, type PriceChange, type SyncTotals } from './bmhome-xml/report'
import { normalizePriceWithMeta } from './bmhome-xml/normalize'
import 'dotenv/config'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

type VariantRaw = {
  active?: string
  variationId?: string
  sku?: string
  barcode?: string
  stockStatus?: string
  price?: string
  discountedPrice?: string
  currency?: string
  currencyName?: string
  size?: string
}

type TechnicalDetail = {
  key?: string
  value?: string
}

type ProductRaw = {
  active?: string
  id?: string
  name?: string
  shortHtml?: string
  descriptionHtml?: string
  brand?: string
  category?: string
  categoryTree?: string
  url?: string
  images: string[]
  variants: VariantRaw[]
  technicalDetails: TechnicalDetail[]
}

type Config = {
  dryRun: boolean
  parseOnly: boolean
  limit?: number
  file?: string
  feedUrl?: string
  reportDir: string
  debug: boolean
}

const PROGRESS_EVERY = 25
const DEFAULT_FEED_URL = 'https://www.bmhome.com.tr/TicimaxXmlV2/7253FC19C30949458CFEA4A870C7779E/'
const DEFAULT_REPORT_DIR = './sync_reports'

function parseArgs(args: string[]): Config {
  let dryRun = false
  let parseOnly = false
  let limit: number | undefined
  let file: string | undefined = process.env.BMHOME_FEED_FILE?.trim() || undefined
  let feedUrl: string | undefined
  let reportDir = process.env.SYNC_REPORT_DIR || DEFAULT_REPORT_DIR
  let debug = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--parse-only') {
      parseOnly = true
    } else if (arg === '--debug') {
      debug = true
    } else if (arg === '--limit' && args[i + 1]) {
      limit = Number(args[i + 1])
      i += 1
    } else if (arg.startsWith('--limit=')) {
      limit = Number(arg.split('=')[1])
    } else if (arg === '--file' && args[i + 1]) {
      file = args[i + 1]
      i += 1
    } else if (arg.startsWith('--file=')) {
      file = arg.split('=')[1]
    } else if (arg === '--feed-url' && args[i + 1]) {
      feedUrl = args[i + 1]
      i += 1
    } else if (arg.startsWith('--feed-url=')) {
      feedUrl = arg.split('=')[1]
    } else if (arg === '--report-dir' && args[i + 1]) {
      reportDir = args[i + 1]
      i += 1
    } else if (arg.startsWith('--report-dir=')) {
      reportDir = arg.split('=')[1]
    }
  }

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    limit = undefined
  }

  return {
    dryRun,
    parseOnly,
    limit,
    file,
    feedUrl,
    reportDir,
    debug,
  }
}

function sanitizeConfig(config: Config) {
  return {
    dryRun: config.dryRun,
    parseOnly: config.parseOnly,
    limit: config.limit,
    file: config.file,
    feedUrl: config.feedUrl,
    reportDir: config.reportDir,
    debug: config.debug,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function ensureLock(reportDir: string, reporter: ReturnType<typeof createReporter>): string {
  const lockPath = path.resolve(process.cwd(), reportDir, '.lock')
  if (fs.existsSync(lockPath)) {
    try {
      const raw = fs.readFileSync(lockPath, 'utf8')
      const data = JSON.parse(raw) as { pid?: number; startedAt?: string }
      if (data.pid && isProcessRunning(data.pid)) {
        reporter.log(`Lock exists (pid ${data.pid}). Exiting.`)
        process.exitCode = 1
        return ''
      }
    } catch {
      // ignore malformed lock
    }
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // ignore
    }
  }
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)
  )
  return lockPath
}

function htmlToText(html: string): string {
  if (!html) return ''
  const $ = load(html)
  return $.text().replace(/\s+/g, ' ').trim()
}

function extractFeatureLists(html: string) {
  if (!html) {
    return { care: [] as string[], technical: [] as string[] }
  }
  const $ = load(html)
  const extract = (match: (title: string) => boolean) => {
    const heading = $('b')
      .filter((_, el) => match($(el).text().trim().toUpperCase()))
      .first()
    if (!heading.length) {
      return [] as string[]
    }
    const list = heading.parent().nextAll('ul').first()
    if (!list.length) {
      return [] as string[]
    }
    return list
      .find('li')
      .map((_, li) => $(li).text().trim())
      .get()
      .filter(Boolean)
  }

  const care = extract((title) => title.includes('CARE') || title.includes('WARRANTY'))
  const technical = extract((title) => title.includes('TECHNICAL'))

  return { care, technical }
}

const SIZE_REGEX = /(\d+(?:\.\d+)?)\s*[x\u00d7\u0445]\s*(\d+(?:\.\d+)?)/i

function parseSizeArea(size: string): number {
  const cleaned = size.replace(/cm/gi, '').trim()
  const match = cleaned.match(SIZE_REGEX)
  if (!match) return 0
  return Number(match[1]) * Number(match[2])
}

function normalizeSizeLabel(size: string): string {
  const cleaned = size.replace(/\s+/g, ' ').trim()
  const match = cleaned.match(SIZE_REGEX)
  if (!match) return cleaned
  return `${match[1]} x ${match[2]} cm`
}

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSpecialSize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isSpecialSizeLabel(value?: string): boolean {
  if (!value) return false
  return normalizeKey(value) === 'OZEL OLCU'
}

function isSizeOptionName(value?: string): boolean {
  if (!value) return false
  const normalized = normalizeSpecialSize(value)
  return (
    normalized === 'size' ||
    normalized.includes('size') ||
    normalized.includes('ebat') ||
    normalized.includes('olcu') ||
    normalized.includes('boyut')
  )
}

function isSizeValue(value?: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (isSpecialSizeLabel(trimmed)) return true
  return SIZE_REGEX.test(trimmed)
}

function buildBmhomeTranslationHash(data: {
  shortHtml?: string | null
  descriptionHtml?: string | null
  technicalDetails?: TechnicalDetail[]
  featureHead?: string
  care?: string[]
  technical?: string[]
  taxonomy?: {
    colors?: string[]
    collections?: string[]
    styles?: string[]
  }
}): string {
  const payload = JSON.stringify({
    shortHtml: data.shortHtml ?? '',
    descriptionHtml: data.descriptionHtml ?? '',
    technicalDetails:
      data.technicalDetails?.map((detail) => ({
        key: detail.key ?? '',
        value: detail.value ?? '',
      })) ?? [],
    featureHead: data.featureHead ?? '',
    care: data.care ?? [],
    technical: data.technical ?? [],
    taxonomy: {
      colors: data.taxonomy?.colors ?? [],
      collections: data.taxonomy?.collections ?? [],
      styles: data.taxonomy?.styles ?? [],
    },
  })
  return createHash('sha256').update(payload).digest('hex')
}

function normalizeFlag(value?: string): boolean {
  const text = (value ?? '').toLowerCase().trim()
  if (!text) return false
  if (['evet', 'true', '1', 'yes', 'y'].includes(text)) return true
  if (['hayir', 'false', '0', 'no', 'n'].includes(text)) return false
  return text.includes('evet')
}

function getAttributeValue(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!attrs) return undefined
  const match = Object.keys(attrs).find((attr) => attr.toLowerCase() === key.toLowerCase())
  if (!match) return undefined
  const value = attrs[match]
  if (value === undefined || value === null) return undefined
  return String(value).trim()
}

function parseStockStatus(value?: string): boolean {
  const text = (value ?? '').toLowerCase().trim()
  if (!text) return false
  const numeric = Number.parseFloat(text.replace(',', '.'))
  if (Number.isFinite(numeric)) return numeric > 0
  if (text.includes('out')) return false
  if (text.includes('yok') || text.includes('tukendi')) return false
  if (text === 'var' || text.includes('var')) return true
  if (text.includes('stok')) return true
  if (text.includes('in stock')) return true
  if (text.includes('available')) return true
  return false
}

function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
  const slug = normalized.replace(/[\s-]+/g, '_').replace(/_+/g, '_')
  return slug || 'bmhome'
}

type BmhomeTaxonomyMappingEntry = {
  by_raw?: Record<string, string>
  by_norm?: Record<string, string>
}

type BmhomeTaxonomyMapping = Record<string, BmhomeTaxonomyMappingEntry>

let bmhomeTaxonomyMappingCache: BmhomeTaxonomyMapping | null = null

function loadBmhomeTaxonomyMapping(): BmhomeTaxonomyMapping {
  if (bmhomeTaxonomyMappingCache) return bmhomeTaxonomyMappingCache
  const mappingPath = path.resolve(process.cwd(), 'scripts/bmhome-xml/bmhome_taxonomy_mapping.json')
  const raw = fs.readFileSync(mappingPath, 'utf8')
  bmhomeTaxonomyMappingCache = JSON.parse(raw) as BmhomeTaxonomyMapping
  return bmhomeTaxonomyMappingCache
}

function mapTaxonomyValue(
  type: 'color' | 'style' | 'collection' | 'category_to_color' | 'categoryTree_to_color',
  raw: string
): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const mapping = loadBmhomeTaxonomyMapping()
  const normalized = normalizeKey(trimmed)
  const typeKeys = [type]
  if (type === 'category_to_color' && mapping.categoryTree_to_color) {
    typeKeys.push('categoryTree_to_color')
  }

  for (const key of typeKeys) {
    const entry = mapping[key]
    const rawMatch = entry?.by_raw?.[trimmed]
    if (rawMatch) return rawMatch
    const normMatch = entry?.by_norm?.[normalized]
    if (normMatch) return normMatch
  }

  return slugify(trimmed)
}

function getUsdToEurRate(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return 1
  }
  return value
}

async function getFeedStream(feedUrl: string, filePath?: string): Promise<NodeJS.ReadableStream> {
  if (filePath) {
    return fs.createReadStream(path.resolve(process.cwd(), filePath))
  }
  const response = await fetch(feedUrl)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch feed (${response.status})`)
  }
  return Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
}

async function main() {
  const config = parseArgs(process.argv.slice(2))
  const reporter = createReporter(config.reportDir, sanitizeConfig(config))
  const reportJsonPath = path.join(reporter.runDir, 'report.json')
  const reportMdPath = path.join(reporter.runDir, 'report.md')

  const startedAt = new Date()
  const totals: SyncTotals = {
    productsFound: 0,
    productsParsed: 0,
    variantsFound: 0,
    variantsParsed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
    hiddenNoPriceCount: 0,
    priceOnRequestCount: 0,
    errorsCount: 0,
  }
  const priceChanged: PriceChange[] = []
  const topErrors: ErrorEntry[] = []
  let fatalError: Error | null = null
  let lockPath = ''

  const prisma = new PrismaClient()
  await prisma.$connect()

  const runIdFromEnv = Number.parseInt(process.env.BMHOME_RUN_ID ?? '', 10)
  const isRunIdValid = Number.isFinite(runIdFromEnv) && runIdFromEnv > 0
  let runId: number | null = null

  const upsertRun = async (data: {
    status: BmhomeSyncStatus
    summaryRu?: string | null
    hintRu?: string | null
    finishedAt?: Date | null
    durationMs?: number | null
  }) => {
    if (!runId) {
      return
    }
    await prisma.bmhomeSyncRun.update({
      where: { id: runId },
      data: {
        status: data.status,
        summaryRu: data.summaryRu ?? undefined,
        hintRu: data.hintRu ?? undefined,
        finishedAt: data.finishedAt ?? undefined,
        durationMs: data.durationMs ?? undefined,
        productsFound: totals.productsFound,
        productsParsed: totals.productsParsed,
        variantsFound: totals.variantsFound,
        variantsParsed: totals.variantsParsed,
        created: totals.created,
        updated: totals.updated,
        unchanged: totals.unchanged,
        deactivated: totals.deactivated,
        hiddenNoPrice: totals.hiddenNoPriceCount,
        hiddenZeroPrice: totals.priceOnRequestCount,
        errorsCount: totals.errorsCount,
        priceChangedCount: priceChanged.length,
        reportDir: reporter.runDir,
        reportJsonPath,
        reportMdPath,
      },
    })
  }

  const startSummary = config.parseOnly
    ? 'Синхронизация запущена (parse-only).'
    : config.dryRun
    ? 'Синхронизация запущена (dry-run, без записи в БД).'
    : 'Синхронизация запущена.'

  if (isRunIdValid) {
    const existingRun = await prisma.bmhomeSyncRun.findUnique({
      where: { id: runIdFromEnv },
    })
    if (existingRun) {
      await prisma.bmhomeSyncRun.update({
        where: { id: runIdFromEnv },
        data: {
          status: BmhomeSyncStatus.RUNNING,
          startedAt,
          summaryRu: startSummary,
          hintRu: null,
          reportDir: reporter.runDir,
          reportJsonPath,
          reportMdPath,
        },
      })
      runId = runIdFromEnv
    }
  }

  if (!runId) {
    const createdRun = await prisma.bmhomeSyncRun.create({
      data: {
        status: BmhomeSyncStatus.RUNNING,
        startedAt,
        summaryRu: startSummary,
        reportDir: reporter.runDir,
        reportJsonPath,
        reportMdPath,
      },
    })
    runId = createdRun.id
  }

  lockPath = ensureLock(config.reportDir, reporter)
  if (!lockPath) {
    const finishedAt = new Date()
    const report = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      config: sanitizeConfig(config),
      totals,
      priceChanged,
      topErrors,
      noteRu: 'Запуск не выполнен: обнаружен активный процесс.',
    }
    reporter.writeReport(report)
    reporter.log('Report saved.')
    process.exitCode = 1
    await upsertRun({
      status: BmhomeSyncStatus.FAILED,
      summaryRu: 'Синхронизация не запущена: уже выполняется другой процесс.',
      hintRu: 'Дождитесь завершения предыдущей синхронизации и попробуйте снова.',
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    })
    reporter.log('Summary: Синхронизация не запущена: уже выполняется другой процесс.')
    reporter.log('Hint: Дождитесь завершения предыдущей синхронизации и попробуйте снова.')
    await prisma.$disconnect()
    return
  }

  const settings = await prisma.bmhomeSyncSettings.findUnique({ where: { id: 1 } })
  const feedUrl = config.feedUrl || settings?.feedUrl || process.env.BMHOME_FEED_URL || DEFAULT_FEED_URL
  let usdToEurRate = getUsdToEurRate(settings?.usdToEurRate ?? Number(process.env.BMHOME_USD_TO_EUR_RATE))

  if (usdToEurRate < 0.2 || usdToEurRate > 2) {
    reporter.log(
      `WARNING: USD -> EUR rate looks wrong (${usdToEurRate}). Fallback to 1. Set a realistic rate in admin settings.`
    )
    usdToEurRate = 1
  }

  reporter.log(`Feed URL: ${feedUrl}`)
  reporter.log(`USD -> EUR rate: ${usdToEurRate}`)


  const handleError = (message: string, data: Partial<ErrorEntry>) => {
    const entry: ErrorEntry = {
      timestamp: new Date().toISOString(),
      message,
      ...data,
    }
    totals.errorsCount += 1
    if (topErrors.length < 10) {
      topErrors.push(entry)
    }
    reporter.writeError(entry)
    reporter.log(`Error: ${message}`)
  }

  const seenProductCodes = new Set<string>()
  const BATCH_DELAY_MS = 0

  const processProduct = async (product: ProductRaw) => {
    const productId = product.id?.trim()
    if (!productId) {
      handleError('Missing UrunKartiID', { context: { name: product.name } })
      return
    }

    const productCode = productId
    if (seenProductCodes.has(productCode)) {
      handleError('Duplicate product in feed', { productCode })
      return
    }
    seenProductCodes.add(productCode)

    const productActive = normalizeFlag(product.active)

    const debugSku = process.env.BMHOME_DEBUG_SKU?.trim()
    const variantData = product.variants.map((variant) => {
      const discounted = normalizePriceWithMeta(variant.discountedPrice)
      const regular = normalizePriceWithMeta(variant.price)
      const salePriceUsd = regular.value && regular.value > 0 ? regular.value : null
      const discountPriceUsd = discounted.value && discounted.value > 0 ? discounted.value : null
      const sizeLabel = variant.size ? normalizeSizeLabel(variant.size) : undefined
      const sizeArea = sizeLabel ? parseSizeArea(sizeLabel) : 0
      const isActive = normalizeFlag(variant.active)
      const isSpecialSize = isSpecialSizeLabel(sizeLabel || variant.size)
      const priceUsdRaw =
        discountPriceUsd && discountPriceUsd > 0 ? variant.discountedPrice ?? '' : variant.price ?? ''

      let priceUsd: number | null = null
      let priceEur: number | null = null
      if (!isSpecialSize) {
        priceUsd = discountPriceUsd && discountPriceUsd > 0 ? discountPriceUsd : salePriceUsd
        priceEur = priceUsd && priceUsd > 0 ? Number((priceUsd * usdToEurRate).toFixed(2)) : null
      }

      const inStock = isActive && parseStockStatus(variant.stockStatus)

      if (debugSku && variant.sku?.trim() === debugSku) {
        reporter.log(
          `BMHOME_DEBUG_SKU sku=${variant.sku || ''} productId=${productId} name=${product.name || ''} sizeLabel=${
            sizeLabel || ''
          } isSpecialSize=${isSpecialSize} priceUsdRaw=${priceUsdRaw} priceUsd=${priceUsd ?? ''} priceEur=${
            priceEur ?? ''
          } currency=${variant.currency || ''} ParaBirimi=${variant.currencyName || ''}`
        )
      }

      return {
        ...variant,
        priceUsd,
        priceEur,
        priceUsdRaw,
        sizeLabel,
        sizeArea,
        isActive,
        inStock,
        isSpecialSize,
        salePriceUsd,
        discountPriceUsd,
      }
    })

    totals.variantsFound += variantData.length

    const parsedVariants = variantData.filter((variant) => Boolean(variant.sizeLabel) && variant.isActive)
    totals.variantsParsed += parsedVariants.length
    const variantsForMeta = parsedVariants.length > 0 ? parsedVariants : variantData

    const variantsWithPrice = parsedVariants.filter(
      (variant) => !variant.isSpecialSize && typeof variant.priceEur === 'number' && variant.priceEur > 0
    )
    const pickMinPrice = (variants: typeof parsedVariants) =>
      variants.reduce<typeof parsedVariants[number] | null>((best, current) => {
        if (!current.priceEur || current.priceEur <= 0) return best
        if (!best) return current
        return current.priceEur < (best.priceEur ?? Number.POSITIVE_INFINITY) ? current : best
      }, null)


    const baseVariant = pickMinPrice(variantsWithPrice)

    const basePriceEur = baseVariant?.priceEur ?? null
    const hasPositivePrice = variantsWithPrice.length > 0
    const hasActiveVariants = parsedVariants.length > 0
    const hasInStockVariant = parsedVariants.some((variant) => variant.inStock)
    const hasSpecialSize = parsedVariants.some((variant) => variant.isSpecialSize)

    const priceOnRequest =
      productActive && !hasPositivePrice && hasActiveVariants && hasInStockVariant && hasSpecialSize

    const sizeVariants = parsedVariants
    const sizes = sizeVariants.map((variant) => variant.sizeLabel as string)
    const uniqueSizes = Array.from(new Set(sizes))

    const specialVariant = parsedVariants.find((variant) => variant.isSpecialSize)
    const defaultSize = baseVariant?.sizeLabel ?? specialVariant?.sizeLabel ?? uniqueSizes[0]


    let newPrice = ''
    let inStock = false

    if (!productActive) {
      totals.deactivated += 1
      newPrice = ''
      inStock = false
    } else if (hasPositivePrice && basePriceEur) {
      newPrice = basePriceEur.toFixed(2)
      inStock = hasInStockVariant
    } else if (priceOnRequest) {
      newPrice = '0.00'
      inStock = hasInStockVariant
      totals.priceOnRequestCount += 1
    } else {
      newPrice = ''
      inStock = hasInStockVariant
      totals.hiddenNoPriceCount += 1
    }


    const shortText = htmlToText(product.shortHtml || '')
    const descriptionText = shortText || htmlToText(product.descriptionHtml || '')

    // featureHead можно оставить как есть, но чтобы не дублировать списки из Aciklama,
    // лучше оставить краткий текст
    const featureHead = htmlToText(product.descriptionHtml || '') || descriptionText

    const { care, technical } = extractFeatureLists(product.descriptionHtml || '')

    const detailMap = new Map<string, string>()
    const detailListMap = new Map<string, string[]>()
    for (const detail of product.technicalDetails) {
      const key = detail.key?.trim()
      const value = detail.value?.trim()
      if (!key || !value) continue
      const upperKey = key.toUpperCase()
      detailMap.set(upperKey, value)
      const list = detailListMap.get(upperKey) ?? []
      list.push(value)
      detailListMap.set(upperKey, list)
    }

    const categoryColorRaw = (product.category || '').trim()
    const detailColorRaw = (detailMap.get('COLOR') || '').trim()
    const colorName = categoryColorRaw || detailColorRaw
    const colorValue = categoryColorRaw
      ? mapTaxonomyValue('category_to_color', categoryColorRaw)
      : detailColorRaw
      ? mapTaxonomyValue('color', detailColorRaw)
      : null

    const styleCandidates = detailListMap.get('STYLE') ?? []
    const styleName = styleCandidates.length > 0 ? styleCandidates[styleCandidates.length - 1].trim() : ''
    const styleValue = styleName ? mapTaxonomyValue('style', styleName) : null

    const collectionName = (detailMap.get('COLLECTION') || '').trim()
    const collectionValue = collectionName ? mapTaxonomyValue('collection', collectionName) : null


    // XML -> model mapping:
    // UrunKartiID -> productCode (external ID), UrunAdi -> productNames,
    // OnYazi/Aciklama -> description/features, Resimler -> images,
    // UrunSecenek/SIZE -> sizes, SatisFiyati/IndirimliFiyat -> price,
    // TeknikDetaylar(COLOR/STYLE/COLLECTION) -> filters, Marka/Kategori/KategoriTree -> metadata.
    const cleanedImages = product.images.map((image) => image.trim()).filter(Boolean)
    const uniqueImages = Array.from(new Set(cleanedImages))

    const existing = await prisma.product.findUnique({
      where: { productCode },
      select: {
        id: true,
        price: true,
        sizes: true,
        defaultSize: true,
        images: true,
        inStock: true,
        isNew: true,
        isRunners: true,
        source: true,
        sourceMeta: true,
        descriptions: { where: { locale: 'ru' }, select: { id: true } },
        features: { where: { locale: 'ru' }, select: { id: true } },
        colors: { where: { locale: 'ru' }, select: { id: true } },
        collections: { where: { locale: 'ru' }, select: { id: true } },
        styles: { where: { locale: 'ru' }, select: { id: true } },
      },
    })

    const existingMeta = (existing?.sourceMeta ?? {}) as Record<string, any>
    const existingBmhomeMeta = existingMeta?.bmhome ?? {}
    const existingTranslationHash = existingBmhomeMeta?.translation?.enHash as string | undefined
    const currentTranslationHash = buildBmhomeTranslationHash({
      shortHtml: product.shortHtml,
      descriptionHtml: product.descriptionHtml,
      technicalDetails: product.technicalDetails,
      featureHead,
      care,
      technical,
      taxonomy: {
        colors: colorName ? [colorName] : [],
        styles: styleName ? [styleName] : [],
        collections: collectionName ? [collectionName] : [],
      },
    })
    const hasRuDescription = (existing?.descriptions?.length ?? 0) > 0
    const hasRuFeature = (existing?.features?.length ?? 0) > 0
    const hasRuColor = (existing?.colors?.length ?? 0) > 0
    const hasRuCollection = (existing?.collections?.length ?? 0) > 0
    const hasRuStyle = (existing?.styles?.length ?? 0) > 0
    const hashChanged = !existingTranslationHash || existingTranslationHash !== currentTranslationHash
    const shouldUpdateRu = hashChanged || !hasRuDescription || !hasRuFeature
    const shouldUpdateTaxonomyRu = hashChanged || !hasRuColor || !hasRuCollection || !hasRuStyle
    const nextTranslation = hashChanged
      ? {
          enHash: currentTranslationHash,
          updatedAt: new Date().toISOString(),
          mode: 'sync',
          scopes: {
            descriptions: false,
            technicalDetails: false,
            lists: false,
            taxonomy: false,
          },
        }
      : {
          ...(existingBmhomeMeta?.translation ?? {}),
          enHash: currentTranslationHash,
        }

    const sourceMeta = {
      ...existingMeta,
      bmhome: {
        ...existingBmhomeMeta,
        productId: productId,
        productUrl: product.url,
        brand: product.brand,
        category: product.category,
        categoryTree: product.categoryTree,
        shortHtml: product.shortHtml,
        descriptionHtml: product.descriptionHtml,
        technicalDetails: product.technicalDetails,
        priceOnRequest,
        translation: nextTranslation,
        variants: variantsForMeta.map((variant) => ({
          variationId: variant.variationId,
          sku: variant.sku,
          barcode: variant.barcode,
          sizeLabel: variant.sizeLabel || variant.size || '',
          isActive: variant.isActive,
          stockStatus: variant.stockStatus,

          // важно для фронта:
          priceUsd: variant.priceUsd,
          priceEur: variant.priceEur,
          priceUsdRaw: variant.priceUsdRaw,
          inStock: variant.inStock,
          isSpecialSize: variant.isSpecialSize,

          salePriceUsd: variant.salePriceUsd,
          discountPriceUsd: variant.discountPriceUsd,
          currency: variant.currency,
          currencyName: variant.currencyName,
        })),

      },
    }

    const finalImages = uniqueImages.length > 0 ? uniqueImages : existing?.images ?? []
    const finalSizes = uniqueSizes.length > 0 ? uniqueSizes : existing?.sizes ?? []
    const finalDefaultSize = defaultSize ?? existing?.defaultSize ?? null

    const updateData = {
      price: newPrice,
      sizes: finalSizes,
      defaultSize: finalDefaultSize,
      images: finalImages,
      inStock,
      isNew: false,
      isRunners: false,
      source: ProductSource.BMHOME,
      sourceMeta,
    }

    const arraysEqual = (a: string[], b: string[]) =>
      a.length === b.length && a.every((value, index) => value === b[index])

    const changed =
      !existing ||
      existing.price !== updateData.price ||
      existing.defaultSize !== updateData.defaultSize ||
      existing.inStock !== updateData.inStock ||
      existing.isNew !== updateData.isNew ||
      existing.isRunners !== updateData.isRunners ||
      existing.source !== updateData.source ||
      !arraysEqual(existing.images, updateData.images) ||
      !arraysEqual(existing.sizes, updateData.sizes)

    if (existing?.price && updateData.price && existing.price !== updateData.price) {
      priceChanged.push({ productCode, oldPrice: existing.price, newPrice: updateData.price })
    }

    if (!config.dryRun && !config.parseOnly) {
      if (existing) {
        await prisma.product.update({
          where: { productCode },
          data: {
            ...updateData,
            productNames: {
              deleteMany: {},
              create: [
                { locale: 'en', name: product.name || productCode },
                { locale: 'ru', name: product.name || productCode },
              ],
            },
            descriptions: {
              deleteMany: shouldUpdateRu ? {} : { locale: 'en' },
              create: [
                { locale: 'en', description: descriptionText },
                ...(shouldUpdateRu ? [{ locale: 'ru', description: descriptionText }] : []),
              ],
            },
            features: {
              deleteMany: shouldUpdateRu ? {} : { locale: 'en' },
              create: [
                {
                  locale: 'en',
                  head: featureHead,
                  careAndWarranty: care,
                  technicalInfo: technical,
                },
                ...(shouldUpdateRu
                  ? [
                      {
                        locale: 'ru',
                        head: featureHead,
                        careAndWarranty: care,
                        technicalInfo: technical,
                      },
                    ]
                  : []),
              ],
            },
            colors: {
              deleteMany: shouldUpdateTaxonomyRu ? {} : { locale: 'en' },
              create: colorName
                ? [
                    { locale: 'en', name: colorName, value: colorValue || slugify(colorName) },
                    ...(shouldUpdateTaxonomyRu
                      ? [{ locale: 'ru', name: colorName, value: colorValue || slugify(colorName) }]
                      : []),
                  ]
                : [],
            },
            collections: {
              deleteMany: shouldUpdateTaxonomyRu ? {} : { locale: 'en' },
              create: collectionName
                ? [
                    { locale: 'en', name: collectionName, value: collectionValue || slugify(collectionName) },
                    ...(shouldUpdateTaxonomyRu
                      ? [{ locale: 'ru', name: collectionName, value: collectionValue || slugify(collectionName) }]
                      : []),
                  ]
                : [],
            },
            styles: {
              deleteMany: shouldUpdateTaxonomyRu ? {} : { locale: 'en' },
              create: styleName
                ? [
                    { locale: 'en', name: styleName, value: styleValue || slugify(styleName) },
                    ...(shouldUpdateTaxonomyRu
                      ? [{ locale: 'ru', name: styleName, value: styleValue || slugify(styleName) }]
                      : []),
                  ]
                : [],
            },
          },
        })
      } else {
        await prisma.product.create({
          data: {
            productCode,
            ...updateData,
            productNames: {
              create: [
                { locale: 'en', name: product.name || productCode },
                { locale: 'ru', name: product.name || productCode },
              ],
            },
            descriptions: {
              create: [
                { locale: 'en', description: descriptionText },
                { locale: 'ru', description: descriptionText },
              ],
            },
            features: {
              create: [
                {
                  locale: 'en',
                  head: featureHead,
                  careAndWarranty: care,
                  technicalInfo: technical,
                },
                {
                  locale: 'ru',
                  head: featureHead,
                  careAndWarranty: care,
                  technicalInfo: technical,
                },
              ],
            },
            colors: {
              create: colorName
                ? [
                    { locale: 'en', name: colorName, value: colorValue || slugify(colorName) },
                    { locale: 'ru', name: colorName, value: colorValue || slugify(colorName) },
                  ]
                : [],
            },
            collections: {
              create: collectionName
                ? [
                    { locale: 'en', name: collectionName, value: collectionValue || slugify(collectionName) },
                    { locale: 'ru', name: collectionName, value: collectionValue || slugify(collectionName) },
                  ]
                : [],
            },
            styles: {
              create: styleName
                ? [
                    { locale: 'en', name: styleName, value: styleValue || slugify(styleName) },
                    { locale: 'ru', name: styleName, value: styleValue || slugify(styleName) },
                  ]
                : [],
            },
          },
        })
      }
    }

    if (!existing) {
      totals.created += 1
    } else if (changed) {
      totals.updated += 1
    } else {
      totals.unchanged += 1
    }
  }

  let lastUpdateAt = 0
  const updateRunProgress = async () => {
    if (!runId) return
    await prisma.bmhomeSyncRun.update({
      where: { id: runId },
      data: {
        productsFound: totals.productsFound,
        productsParsed: totals.productsParsed,
        variantsFound: totals.variantsFound,
        variantsParsed: totals.variantsParsed,
        created: totals.created,
        updated: totals.updated,
        unchanged: totals.unchanged,
        deactivated: totals.deactivated,
        hiddenNoPrice: totals.hiddenNoPriceCount,
        hiddenZeroPrice: totals.priceOnRequestCount,
        errorsCount: totals.errorsCount,
        priceChangedCount: priceChanged.length,
      },
    })
  }

  let parserError: Error | null = null
  let stopRequested = false
  const queue: ProductRaw[] = []
  let draining = false
  let drainPromise: Promise<void> | null = null

  const drainQueue = async () => {
    draining = true
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) break
      totals.productsFound += 1
      try {
        await processProduct(next)
      } catch (error) {
        handleError('Product import failed', {
          productCode: next.id,
          context: { error: (error as Error).message },
          stack: (error as Error).stack,
        })
      }
      totals.productsParsed += 1
      if (totals.productsParsed % PROGRESS_EVERY === 0) {
        reporter.log(
          `Progress: parsed ${totals.productsParsed}, created ${totals.created}, updated ${totals.updated}, hidden ${
            totals.hiddenNoPriceCount
          }, price-on-request ${totals.priceOnRequestCount}.`
        )
      }
      if (runId && totals.productsParsed - lastUpdateAt >= PROGRESS_EVERY) {
        lastUpdateAt = totals.productsParsed
        await updateRunProgress()
      }
      if (config.limit && totals.productsParsed >= config.limit) {
        stopRequested = true
        break
      }
      if (BATCH_DELAY_MS > 0) {
        await sleep(BATCH_DELAY_MS)
      }
    }
    draining = false
  }

  try {
    const stream = await getFeedStream(feedUrl, config.file)
    const parser = sax.parser(true, { trim: false, normalize: false })
    const elementStack: string[] = []
    const textStack: string[] = []
    let currentProduct: ProductRaw | null = null
    let currentVariant: VariantRaw | null = null
    let currentVariantOption: { name?: string; value?: string } | null = null
    let currentDetail: TechnicalDetail | null = null
    const variantOptionTags = new Set(['Ozellik', 'SecenekOzellik', 'SecenekOzelligi', 'SecenekOzellikleri'])
    const variantOptionNameTags = new Set(['Tanim', 'OzellikTanim', 'SecenekTanim', 'SecenekAdi'])
    const variantOptionValueTags = new Set(['Deger', 'OzellikDeger', 'SecenekDeger', 'DegerTanim'])
    const variantSizeTags = new Set(['SecenekAdi', 'SecenekDeger', 'Ebat', 'Boyut', 'Size', 'Beden'])
    const assignVariantSize = (candidate?: string) => {
      if (!currentVariant) return
      if (!candidate || currentVariant.size) return
      if (isSizeValue(candidate)) {
        currentVariant.size = candidate.trim()
      }
    }
    const applyVariantOption = () => {
      if (!currentVariant || !currentVariantOption) return
      const optionValue = currentVariantOption.value?.trim()
      if (!optionValue || currentVariant.size) return
      if (isSizeOptionName(currentVariantOption.name) || isSizeValue(optionValue)) {
        currentVariant.size = optionValue
      }
    }

    parser.onerror = (error) => {
      parserError = error
      fatalError = error
      stopRequested = true
      handleError('XML parse error', { context: { error: error.message } })
    }

    parser.onopentag = (node) => {
      elementStack.push(node.name)
      textStack.push('')
      if (node.name === 'Urun') {
        currentProduct = {
          images: [],
          variants: [],
          technicalDetails: [],
        }
      } else if (node.name === 'Secenek') {
        currentVariant = {}
        currentVariantOption = null
      } else if (node.name === 'TeknikDetay') {
        currentDetail = {}
      }

      if (currentVariant && !currentDetail) {
        if (variantOptionTags.has(node.name)) {
          currentVariantOption = {}
        } else if ((node.name === 'SecenekAdi' || node.name === 'SecenekDeger') && !currentVariantOption) {
          currentVariantOption = {}
        }

        if (currentVariantOption) {
          const optionName = getAttributeValue(node.attributes as Record<string, unknown>, 'Tanim')
          const optionValue = getAttributeValue(node.attributes as Record<string, unknown>, 'Deger')
          if (optionName) {
            currentVariantOption.name = optionName
          }
          if (optionValue) {
            currentVariantOption.value = optionValue
          }
          if (
            currentVariantOption.value &&
            !currentVariant.size &&
            (isSizeOptionName(currentVariantOption.name) || isSizeValue(currentVariantOption.value))
          ) {
            currentVariant.size = currentVariantOption.value.trim()
          }
        }
      }
    }

    parser.ontext = (text) => {
      if (textStack.length > 0) {
        textStack[textStack.length - 1] += text
      }
    }

    parser.oncdata = (text) => {
      if (textStack.length > 0) {
        textStack[textStack.length - 1] += text
      }
    }

    parser.onclosetag = (name) => {
      const value = textStack.pop()?.trim() ?? ''
      elementStack.pop()

      if (currentVariant) {
        if (name === 'Aktif') currentVariant.active = value
        if (name === 'VaryasyonID') currentVariant.variationId = value
        if (name === 'StokKodu') currentVariant.sku = value
        if (name === 'Barkod') currentVariant.barcode = value
        if (name === 'StokDurumu') currentVariant.stockStatus = value
        if (name === 'SatisFiyati') currentVariant.price = value
        if (name === 'IndirimliFiyat') currentVariant.discountedPrice = value
        if (name === 'ParaBirimiKodu') currentVariant.currency = value
        if (name === 'ParaBirimi') currentVariant.currencyName = value

        if (!currentDetail) {
          if (variantOptionNameTags.has(name)) {
            if (!currentVariantOption) currentVariantOption = {}
            currentVariantOption.name = value
            if (name === 'SecenekAdi') {
              assignVariantSize(value)
            }
            applyVariantOption()
          }
          if (variantOptionValueTags.has(name)) {
            if (!currentVariantOption) currentVariantOption = {}
            currentVariantOption.value = value
            applyVariantOption()
            if (name === 'SecenekDeger') {
              currentVariantOption = null
            }
          }

          if (variantSizeTags.has(name)) {
            assignVariantSize(value)
          }

          if (name === 'Ozellik') {
            assignVariantSize(value)
            applyVariantOption()
            currentVariantOption = null
          }

          if (variantOptionTags.has(name)) {
            applyVariantOption()
            currentVariantOption = null
          }
        }
      }

      if (currentDetail) {
        if (name === 'OzellikTanim') currentDetail.key = value
        if (name === 'DegerTanim') currentDetail.value = value
      }

      if (currentProduct && !currentVariant && !currentDetail) {
        if (name === 'Aktif') currentProduct.active = value
        if (name === 'UrunKartiID') currentProduct.id = value
        if (name === 'UrunAdi') currentProduct.name = value
        if (name === 'OnYazi') currentProduct.shortHtml = value
        if (name === 'Aciklama') currentProduct.descriptionHtml = value
        if (name === 'Marka') currentProduct.brand = value
        if (name === 'Kategori') currentProduct.category = value
        if (name === 'KategoriTree') currentProduct.categoryTree = value
        if (name === 'UrunUrl') currentProduct.url = value
        if (name === 'Resim' && value) currentProduct.images.push(value)
      }

      if (name === 'TeknikDetay' && currentProduct && currentDetail) {
        currentProduct.technicalDetails.push(currentDetail)
        currentDetail = null
      }

      if (name === 'Secenek' && currentProduct && currentVariant) {
        currentProduct.variants.push(currentVariant)
        currentVariant = null
        currentVariantOption = null
      }

      if (name === 'Urun' && currentProduct) {
        queue.push(currentProduct)
        currentProduct = null
      }
    }

    for await (const chunk of stream) {
      if (stopRequested) break
      parser.write(chunk.toString('utf8'))
      if (queue.length >= PROGRESS_EVERY && !draining) {
        drainPromise = drainQueue()
        await drainPromise
      }
      if (parserError) {
        stopRequested = true
        break
      }
      if (stopRequested) break
    }

    parser.close()

    if (queue.length > 0 && !stopRequested) {
      await drainQueue()
    }
  } catch (error) {
    fatalError = error as Error
    handleError('Feed processing failed', {
      context: { error: (error as Error).message },
      stack: (error as Error).stack,
    })
    process.exitCode = 1
  }

  try {
    if (!config.dryRun && !config.parseOnly && totals.productsFound > 0) {
      const missing = await prisma.product.findMany({
        where: {
          source: ProductSource.BMHOME,
          productCode: { notIn: Array.from(seenProductCodes) },
          price: { not: '' },
        },
        select: { productCode: true },
      })

      if (missing.length > 0) {
        totals.deactivated += missing.length
        await prisma.product.updateMany({
          where: {
            source: ProductSource.BMHOME,
            productCode: { notIn: Array.from(seenProductCodes) },
          },
          data: {
            price: '',
            inStock: false,
            sizes: [],
            defaultSize: null,
          },
        })
      }
    }
  } catch (error) {
    fatalError = error as Error
    handleError('Failed to deactivate missing products', {
      context: { error: (error as Error).message },
      stack: (error as Error).stack,
    })
  }

  const finishedAt = new Date()
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    config: sanitizeConfig(config),
    totals,
    priceChanged,
    topErrors,
    noteRu: `Цены в фиде USD. Конвертация в EUR по курсу ${usdToEurRate}.`,
  }
  reporter.writeReport(report)
  reporter.log('Report saved.')

  let finalStatus: BmhomeSyncStatus = BmhomeSyncStatus.SUCCESS
  let summaryRu = config.parseOnly
    ? `Parse-only завершен. Найдено ${totals.productsFound}, обработано ${totals.productsParsed}, вариантов ${totals.variantsFound}.`
    : config.dryRun
    ? `Dry-run завершен. Найдено ${totals.productsFound}, создано ${totals.created}, обновлено ${totals.updated}, деактивировано ${totals.deactivated}.`
    : `Синхронизация завершена. Найдено ${totals.productsFound}, создано ${totals.created}, обновлено ${totals.updated}, деактивировано ${totals.deactivated}.`
  if (totals.errorsCount > 0) {
    summaryRu = `${summaryRu} Ошибок: ${totals.errorsCount}.`
  }

  let hintRu: string | null = null
  if (fatalError) {
    finalStatus = BmhomeSyncStatus.FAILED
    summaryRu = 'Синхронизация завершилась с ошибкой.'
    hintRu = 'Проверьте доступ к XML фиду и журнал запуска.'
    process.exitCode = process.exitCode ?? 1
  }

  reporter.log(`Summary: ${summaryRu}`)
  if (hintRu) {
    reporter.log(`Hint: ${hintRu}`)
  }

  await upsertRun({
    status: finalStatus,
    summaryRu,
    hintRu,
    finishedAt,
    durationMs: report.durationMs,
  })

  try {
    fs.unlinkSync(lockPath)
  } catch {
    // ignore
  }

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
