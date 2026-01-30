import fs from 'node:fs'
import path from 'node:path'
import { CheerioCrawler, PlaywrightCrawler, RequestQueue } from 'crawlee'
import { BmhomeSyncStatus, PrismaClient, ProductSource } from '@prisma/client'
import { load, type CheerioAPI } from 'cheerio'
import { loadConfig } from './bmhome/lib/config'
import {
  extractImages,
  extractInStock,
  extractIsNew,
  extractIsRunners,
  extractPrice,
  extractProductCode,
  extractProductLinks,
  extractSizes,
} from './bmhome/lib/extract'
import { normalizePriceWithMeta } from './bmhome/lib/normalize'
import { createReporter, type ErrorEntry, type PriceChange, type SyncTotals } from './bmhome/lib/report'

type ListingContext = {
  label: 'LISTING'
  fromNewListing: boolean
  fromRunnersListing: boolean
}

type ProductContext = {
  label: 'PRODUCT'
  fromNewListing: boolean
  fromRunnersListing: boolean
}

type RequestContext = ListingContext | ProductContext

const PROGRESS_EVERY = 25
const CURRENCY_NOTE_RU =
  'Цены на источнике BMHOME в EUR. На витрине RU показываем в RUB по текущему курсу (ЦБ) автоматически.'
const NEED_AUTH_SUMMARY_RU =
  'Синхронизация остановлена: BMHOME требует подтверждение доступа (капча/проверка).'
const NEED_AUTH_HINT_RU =
  'Синхронизация не смогла получить товары, сайт показывает дефолтный каталог. Нужно открыть окно проверки BMHOME.'
const FAILED_HINT_RU =
  'Синхронизация не смогла получить товары, сайт показывает дефолтный каталог. Проверьте доступ к BMHOME, соединение с БД и run.log/report.md.'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function detectNeedAuth(html: string): string | null {
  const lower = html.toLowerCase()
  const patterns = [
    'cf-challenge',
    'cloudflare',
    'attention required',
    'just a moment',
    'verify you are human',
    'captcha',
    'g-recaptcha',
    'hcaptcha',
    'access denied',
    'forbidden',
    'robot check',
    'enable javascript',
  ]
  const matched = patterns.find((pattern) => lower.includes(pattern))
  if (matched) {
    return matched
  }
  return null
}

function isProductUrl(pathname: string): boolean {
  const lowered = pathname.toLowerCase()
  return (
    lowered.includes('/urun') ||
    lowered.includes('/product') ||
    lowered.includes('/p/') ||
    lowered.includes('/product-detail')
  )
}

function normalizeUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(rawUrl, baseUrl)
    resolved.hash = ''

    const paramsToRemove = new Set(['srsltid', 'gclid', 'fbclid'])
    for (const key of Array.from(resolved.searchParams.keys())) {
      if (paramsToRemove.has(key)) {
        resolved.searchParams.delete(key)
        continue
      }
      if (key.toLowerCase().startsWith('utm_')) {
        resolved.searchParams.delete(key)
      }
    }

    if (isProductUrl(resolved.pathname)) {
      resolved.search = ''
    }

    return resolved.toString()
  } catch {
    return null
  }
}

function inferListingContext(url: string) {
  const normalized = url.toLowerCase()
  return {
    fromNewListing: normalized.includes('new') || normalized.includes('yeni'),
    fromRunnersListing: normalized.includes('runner') || normalized.includes('runners') || normalized.includes('yolluk'),
  }
}

function extractPaginationLinks(htmlBaseUrl: string, rawLinks: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const link of rawLinks) {
    const normalized = normalizeUrl(link, htmlBaseUrl)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function getPaginationLinks($: CheerioAPI, baseUrl: string): string[] {
  const links: string[] = []
  $('a[rel="next"], link[rel="next"], a.pagination__next, a.next, a[aria-label*="Next"], a[aria-label*="next"]').each(
    (_, element) => {
      const href = $(element).attr('href')
      if (href) {
        links.push(href)
      }
    }
  )
  return extractPaginationLinks(baseUrl, links)
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function sanitizeConfig(config: ReturnType<typeof loadConfig>) {
  return {
    baseUrl: config.baseUrl,
    startUrls: config.startUrls,
    maxConcurrency: config.maxConcurrency,
    rateLimitMs: config.rateLimitMs,
    usePlaywright: config.usePlaywright,
    userDataDir: config.userDataDir,
    reportDir: config.reportDir,
    dryRun: config.dryRun,
    limit: config.limit,
    since: config.since,
    debug: config.debug,
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

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function main() {
  const config = loadConfig(process.argv.slice(2))
  const reporter = createReporter(config.reportDir, sanitizeConfig(config))
  const reportJsonPath = path.join(reporter.runDir, 'report.json')
  const reportMdPath = path.join(reporter.runDir, 'report.md')
  if (!process.env.BMHOME_START_URLS) {
    reporter.log('BMHOME_START_URLS is not set. Using fallback category paths.')
  }
  const startedAt = new Date()
  const totals: SyncTotals = {
    productsFound: 0,
    productsParsed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    hiddenNoPrice: 0,
    hiddenZeroPrice: 0,
    errorsCount: 0,
  }
  const priceChanged: PriceChange[] = []
  const topErrors: ErrorEntry[] = []
  let needsAuthDetected = false
  let fatalError: Error | null = null
  let abortCrawler: (() => void) | null = null
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
        created: totals.created,
        updated: totals.updated,
        unchanged: totals.unchanged,
        hiddenNoPrice: totals.hiddenNoPrice,
        hiddenZeroPrice: totals.hiddenZeroPrice,
        errorsCount: totals.errorsCount,
        priceChangedCount: priceChanged.length,
        reportDir: reporter.runDir,
        reportJsonPath,
        reportMdPath,
      },
    })
  }

  const startSummary = config.dryRun
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
      noteRu: CURRENCY_NOTE_RU,
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

  const resolvedUserDataDir = path.resolve(process.cwd(), config.userDataDir)
  if (config.usePlaywright) {
    fs.mkdirSync(resolvedUserDataDir, { recursive: true })
    reporter.log(`Using persistent BMHOME profile at: ${resolvedUserDataDir}`)
  }

  const requestQueue = await RequestQueue.open()
  const queuedProducts = new Set<string>()

  for (const startUrl of config.startUrls) {
    const inferred = inferListingContext(startUrl)
    await requestQueue.addRequest({
      url: startUrl,
      userData: {
        label: 'LISTING',
        fromNewListing: inferred.fromNewListing,
        fromRunnersListing: inferred.fromRunnersListing,
      } satisfies ListingContext,
    })
  }

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

  const markNeedAuth = async (reason: string, url?: string) => {
    if (needsAuthDetected) {
      return
    }
    needsAuthDetected = true
    const message = `${NEED_AUTH_SUMMARY_RU} (${reason})`
    handleError(message, { url })
    await upsertRun({
      status: BmhomeSyncStatus.NEED_AUTH,
      summaryRu: NEED_AUTH_SUMMARY_RU,
      hintRu: NEED_AUTH_HINT_RU,
    })
    try {
      abortCrawler?.()
    } catch {
      // ignore
    }
  }

  const processPage = async ($: CheerioAPI, request: { url: string; userData: RequestContext }) => {
    if (needsAuthDetected) {
      return
    }
    const requestContext = request.userData
    if (requestContext.label === 'LISTING') {
      const listingLinks = extractProductLinks($)
      const listingContext = {
        fromNewListing: requestContext.fromNewListing,
        fromRunnersListing: requestContext.fromRunnersListing,
      }

      for (const link of listingLinks) {
        if (config.limit && queuedProducts.size >= config.limit) {
          break
        }
        const normalized = normalizeUrl(link, request.url)
        if (!normalized || queuedProducts.has(normalized)) {
          continue
        }
        queuedProducts.add(normalized)
        totals.productsFound = queuedProducts.size

        await requestQueue.addRequest({
          url: normalized,
          userData: {
            label: 'PRODUCT',
            fromNewListing: listingContext.fromNewListing,
            fromRunnersListing: listingContext.fromRunnersListing,
          } satisfies ProductContext,
        })
      }

      if (!config.limit || queuedProducts.size < config.limit) {
        const paginationLinks = getPaginationLinks($, request.url)
        for (const nextLink of paginationLinks) {
          await requestQueue.addRequest({
            url: nextLink,
            userData: {
              label: 'LISTING',
              fromNewListing: listingContext.fromNewListing,
              fromRunnersListing: listingContext.fromRunnersListing,
            } satisfies ListingContext,
          })
        }
      }

      if (config.debug) {
        reporter.log(`Listing processed: ${request.url}. Found ${listingLinks.length} links, total ${totals.productsFound}.`)
      }
      return
    }

    const productCode = extractProductCode($, request.url)
    if (!productCode) {
      handleError('Missing product code', { url: request.url })
      return
    }

    totals.productsParsed += 1

    const rawPrice = extractPrice($)
    const priceMeta = normalizePriceWithMeta(rawPrice)
    const price = priceMeta.normalized

    if (priceMeta.reason === 'no_price' || priceMeta.reason === 'invalid') {
      totals.hiddenNoPrice += 1
    } else if (priceMeta.reason === 'zero_or_negative') {
      totals.hiddenZeroPrice += 1
    }

    const imagesRaw = extractImages($)
    const images = imagesRaw
      .map((image) => normalizeUrl(image, request.url))
      .filter((image): image is string => Boolean(image))
    const sizes = extractSizes($)
    const isNew = extractIsNew($, requestContext.fromNewListing)
    const isRunners = extractIsRunners($, requestContext.fromRunnersListing)

    const stockSignal = extractInStock($)
    let inStock = stockSignal ?? price.length > 0
    if (!price) {
      inStock = false
    }

    const existing = await prisma.product.findUnique({
      where: { productCode },
    })

    const updateImages = images.length > 0 ? images : existing?.images ?? []
    const updateSizes = sizes.length > 0 ? sizes : existing?.sizes ?? []
    const updateData = {
      price,
      images: updateImages,
      sizes: updateSizes,
      inStock,
      isNew,
      isRunners,
      source: ProductSource.BMHOME,
    }

    if (existing) {
      if (existing.price !== price) {
        priceChanged.push({
          productCode,
          oldPrice: existing.price,
          newPrice: price,
        })
      }

      const changed =
        existing.price !== updateData.price ||
        existing.inStock !== updateData.inStock ||
        existing.isNew !== updateData.isNew ||
        existing.isRunners !== updateData.isRunners ||
        existing.source !== updateData.source ||
        !arraysEqual(existing.images, updateData.images) ||
        !arraysEqual(existing.sizes, updateData.sizes)

      if (changed) {
        totals.updated += 1
        if (!config.dryRun) {
          await prisma.product.update({
            where: { productCode },
            data: updateData,
          })
        }
      } else {
        totals.unchanged += 1
      }
    } else {
      totals.created += 1
      if (!config.dryRun) {
        await prisma.product.create({
          data: {
            productCode,
            price,
            images,
            sizes,
            inStock,
            isNew,
            isRunners,
            source: ProductSource.BMHOME,
          },
        })
      }
    }

    if (totals.productsParsed % PROGRESS_EVERY === 0) {
      reporter.log(
        `Progress: parsed ${totals.productsParsed}, created ${totals.created}, updated ${totals.updated}, hidden ${
          totals.hiddenNoPrice + totals.hiddenZeroPrice
        }.`
      )
    }
  }

  const handleFailed = (request: { url: string }) => {
    handleError('Request failed', { url: request.url })
  }

  const cheerioCrawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: config.maxConcurrency,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    async requestHandler(context) {
      if (config.rateLimitMs > 0) {
        await sleep(config.rateLimitMs)
      }
      try {
        const htmlRaw = context.body ?? context.$?.html() ?? ''
        const html = typeof htmlRaw === 'string' ? htmlRaw : htmlRaw.toString('utf8')
        const authReason = html ? detectNeedAuth(html) : null
        if (authReason) {
          await markNeedAuth(authReason, context.request.url)
          return
        }
        await processPage(context.$ as any, {
          url: context.request.url,
          userData: context.request.userData as RequestContext,
        })
      } catch (error) {
        handleError('Unhandled product parse error', {
          url: context.request.url,
          context: { error: (error as Error).message },
          stack: (error as Error).stack,
        })
      }
    },
    async failedRequestHandler({ request }) {
      handleFailed({ url: request.url })
    },
  })

  const buildPlaywrightCrawler = () =>
    new PlaywrightCrawler({
      requestQueue,
      maxConcurrency: config.maxConcurrency,
      useSessionPool: false,
      launchContext: {
        userDataDir: resolvedUserDataDir,
        launchOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
      maxRequestRetries: 3,
      requestHandlerTimeoutSecs: 90,
      async requestHandler(context) {
        if (config.rateLimitMs > 0) {
          await sleep(config.rateLimitMs)
        }
        try {
          const html = await context.page.content()
          const authReason = detectNeedAuth(html)
          if (authReason) {
            await markNeedAuth(authReason, context.request.url)
            return
          }
          const $ = load(html)
          await processPage($, {
            url: context.request.url,
            userData: context.request.userData as RequestContext,
          })
        } catch (error) {
          handleError('Unhandled product parse error', {
            url: context.request.url,
            context: { error: (error as Error).message },
            stack: (error as Error).stack,
          })
        }
      },
      async failedRequestHandler({ request }) {
        handleFailed({ url: request.url })
      },
    })

  try {
    if (config.usePlaywright) {
      reporter.log('Using PlaywrightCrawler (BMHOME_USE_PLAYWRIGHT=1).')
      try {
        const playwrightCrawler = buildPlaywrightCrawler()
        abortCrawler = () => {
          void playwrightCrawler.autoscaledPool?.abort()
        }
        await playwrightCrawler.run()
      } catch (error) {
        handleError('Playwright crawler failed to start. Is Playwright installed?', {
          context: { error: (error as Error).message },
        })
        fatalError = error as Error
        process.exitCode = 1
      }
    } else {
      abortCrawler = () => {
        void cheerioCrawler.autoscaledPool?.abort()
      }
      try {
        await cheerioCrawler.run()
      } catch (error) {
        handleError('Cheerio crawler failed to start.', {
          context: { error: (error as Error).message },
        })
        fatalError = error as Error
        process.exitCode = 1
      }
    }
  } finally {
    const finishedAt = new Date()
    const report = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      config: sanitizeConfig(config),
      totals,
      priceChanged,
      topErrors,
      noteRu: CURRENCY_NOTE_RU,
    }
    reporter.writeReport(report)
    reporter.log('Report saved.')

    const hiddenTotal = totals.hiddenNoPrice + totals.hiddenZeroPrice
    let finalStatus: BmhomeSyncStatus = BmhomeSyncStatus.SUCCESS
    let summaryRu = config.dryRun
      ? `Dry-run завершен. Найдено ${totals.productsFound}, создано ${totals.created}, обновлено ${totals.updated}, скрыто ${hiddenTotal}.`
      : `Синхронизация завершена. Найдено ${totals.productsFound}, создано ${totals.created}, обновлено ${totals.updated}, скрыто ${hiddenTotal}.`
    if (totals.errorsCount > 0) {
      summaryRu = `${summaryRu} Ошибок: ${totals.errorsCount}.`
    }
    let hintRu: string | null = null

    if (needsAuthDetected) {
      finalStatus = BmhomeSyncStatus.NEED_AUTH
      summaryRu = NEED_AUTH_SUMMARY_RU
      hintRu = NEED_AUTH_HINT_RU
      process.exitCode = process.exitCode ?? 2
    } else if (fatalError) {
      finalStatus = BmhomeSyncStatus.FAILED
      summaryRu = 'Синхронизация завершилась с ошибкой.'
      hintRu = FAILED_HINT_RU
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
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
