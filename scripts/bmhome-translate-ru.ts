import { PrismaClient, Prisma, ProductSource } from '@prisma/client'
import { load } from 'cheerio'
import { createHash } from 'node:crypto'
import 'dotenv/config'

type TechnicalDetail = {
  key?: string
  value?: string
}

type TranslationScopes = {
  descriptions?: boolean
  technicalDetails?: boolean
  lists?: boolean
  taxonomy?: boolean
}

type BmhomeMeta = {
  shortHtml?: string | null
  descriptionHtml?: string | null
  technicalDetails?: TechnicalDetail[]
  shortHtmlRu?: string | null
  descriptionHtmlRu?: string | null
  technicalDetailsRu?: TechnicalDetail[]
  translation?: {
    enHash?: string
    updatedAt?: string
    mode?: string
    scopes?: TranslationScopes
  }
}

const prisma = new PrismaClient()
const translateUrlRaw = process.env.BMHOME_TRANSLATE_URL?.trim()
const translateEndpoint = translateUrlRaw
  ? translateUrlRaw.endsWith('/translate')
    ? translateUrlRaw
    : `${translateUrlRaw.replace(/\/$/, '')}/translate`
  : null

type TranslateMode = 'translate' | 'copy_en'

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false
  return fallback
}

const translateMode: TranslateMode =
  (process.env.BMHOME_TRANSLATE_MODE || '').toLowerCase() === 'copy_en' ? 'copy_en' : 'translate'
const translateDescriptions = parseFlag(process.env.BMHOME_TRANSLATE_DESC, true)
const translateTechnicalDetails = parseFlag(process.env.BMHOME_TRANSLATE_TECH, true)
const translateLists = parseFlag(process.env.BMHOME_TRANSLATE_LISTS, true)
const translateTaxonomy = parseFlag(process.env.BMHOME_TRANSLATE_TAXONOMY, false)

function needsRuOverwrite(ruText?: string | null, enText?: string | null): boolean {
  const ru = (ruText ?? '').trim()
  const en = (enText ?? '').trim()
  if (!ru) return true
  if (ru === en) return true
  return !/[А-Яа-яЁё]/.test(ru)
}

function needsRuListOverwrite(ruList?: string[] | null, enList?: string[] | null): boolean {
  const ru = (ruList ?? []).filter(Boolean)
  const en = (enList ?? []).filter(Boolean)
  if (ru.length === 0) return true
  const ruJoined = ru.join(' ').trim()
  const enJoined = en.join(' ').trim()
  if (ruJoined === enJoined) return true
  return !/[А-Яа-яЁё]/.test(ruJoined)
}

const glossaryEntries: Array<[string, string]> = [
  ['Pile height', 'Высота ворса'],
  ['Total height', 'Общая высота'],
  ['Thickness', 'Толщина'],
  ['Weight', 'Вес'],
  ['Backing', 'Основа'],
  ['Origin', 'Происхождение'],
  ['Made in', 'Сделано в'],
  ['Made of', 'Состав'],
  ['Acrylic', 'Акрил'],
  ['Polyester', 'Полиэстер'],
  ['Cotton', 'Хлопок'],
  ['Wool', 'Шерсть'],
  ['Viscose', 'Вискоза'],
  ['Polypropylene', 'Полипропилен'],
  ['Easy to clean', 'Легко чистится'],
  ['Do not wash', 'Не стирать'],
  ['Do not bleach', 'Не отбеливать'],
  ['Do not tumble dry', 'Не сушить в барабане'],
  ['Do not iron', 'Не гладить'],
  ['Dry clean', 'Химчистка'],
  ['Suitable for use throughout the home', 'Подходит для использования по всему дому'],
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyGlossary(text: string): string {
  let result = text
  const sorted = [...glossaryEntries].sort((a, b) => b[0].length - a[0].length)
  for (const [source, target] of sorted) {
    const pattern = new RegExp(escapeRegExp(source), 'gi')
    result = result.replace(pattern, target)
  }
  return result
}

function protectPlaceholders(input: string) {
  const placeholders: Record<string, string> = {}
  let counter = 0
  const makeToken = () => `__PH_${counter++}__`

  const patterns = [
    /\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m|m2|m²)?\b/gi,
    /\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|m2|m²|kg|g|%|sqm|pcs|шт|inch|in|ft)\b/gi,
    /\b\d+(?:[.,]\d+)?\b/g,
  ]

  let text = input
  for (const pattern of patterns) {
    text = text.replace(pattern, (match) => {
      const token = makeToken()
      placeholders[token] = match
      return token
    })
  }

  return { text, placeholders }
}

function restorePlaceholders(input: string, placeholders: Record<string, string>): string {
  let text = input
  for (const [token, value] of Object.entries(placeholders)) {
    text = text.replace(new RegExp(escapeRegExp(token), 'g'), value)
  }
  return text
}

async function translateWithLibre(text: string, format: 'text' | 'html') {
  if (!translateEndpoint) return text
  const response = await fetch(translateEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: 'en',
      target: 'ru',
      format,
    }),
  })

  if (!response.ok) {
    throw new Error(`LibreTranslate error: ${response.status}`)
  }

  const data = (await response.json()) as { translatedText?: string; translation?: string }
  return data.translatedText || data.translation || text
}

async function translateText(input: string, format: 'text' | 'html' = 'text') {
  if (!input || !input.trim()) return input
  if (translateMode === 'copy_en') return input
  const { text: protectedText, placeholders } = protectPlaceholders(input)
  let result = protectedText

  if (translateEndpoint) {
    try {
      result = await translateWithLibre(result, format)
    } catch (error) {
      console.warn('Translate failed, fallback to glossary:', (error as Error).message)
      result = protectedText
    }
  }

  result = applyGlossary(result)
  result = restorePlaceholders(result, placeholders)
  return result
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

function buildBmhomeTranslationHash(params: {
  bmhome: BmhomeMeta
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
    shortHtml: params.bmhome.shortHtml ?? '',
    descriptionHtml: params.bmhome.descriptionHtml ?? '',
    technicalDetails:
      params.bmhome.technicalDetails?.map((detail) => ({
        key: detail.key ?? '',
        value: detail.value ?? '',
      })) ?? [],
    featureHead: params.featureHead ?? '',
    care: params.care ?? [],
    technical: params.technical ?? [],
    taxonomy: {
      colors: params.taxonomy?.colors ?? [],
      collections: params.taxonomy?.collections ?? [],
      styles: params.taxonomy?.styles ?? [],
    },
  })
  return createHash('sha256').update(payload).digest('hex')
}

async function main() {
  console.log('BMHOME RU translation started.')
  console.log(`Mode: ${translateMode}`)
  console.log(
    `Translator: ${
      translateMode === 'translate' ? translateEndpoint || 'glossary-only' : 'copy_en'
    }`
  )
  console.log(
    `Scopes: desc=${translateDescriptions} tech=${translateTechnicalDetails} lists=${translateLists} taxonomy=${translateTaxonomy}`
  )

  const products = await prisma.product.findMany({
    where: { source: ProductSource.BMHOME },
    select: {
      id: true,
      productCode: true,
      sourceMeta: true,
      descriptions: { select: { locale: true, description: true } },
      features: { select: { locale: true, head: true, careAndWarranty: true, technicalInfo: true } },
      colors: { select: { locale: true, name: true, value: true } },
      collections: { select: { locale: true, name: true, value: true } },
      styles: { select: { locale: true, name: true, value: true } },
    },
  })

  console.log(`TOTAL=${products.length}`)

  let translatedCount = 0
  let skippedCount = 0
  let errorCount = 0
  let processedCount = 0

  for (const product of products) {
    try {
      const sourceMeta = (product.sourceMeta ?? {}) as Record<string, any>
      const bmhome = (sourceMeta.bmhome ?? {}) as BmhomeMeta

      const descriptions = product.descriptions ?? []
      const features = product.features ?? []
      const colors = product.colors ?? []
      const collections = product.collections ?? []
      const styles = product.styles ?? []

      const descriptionEn = descriptions.find((d) => d.locale === 'en')?.description ?? ''
      const descriptionRu = descriptions.find((d) => d.locale === 'ru')?.description ?? ''
      const featureEn = features.find((f) => f.locale === 'en')
      const featureRu = features.find((f) => f.locale === 'ru')

      let careList = featureEn?.careAndWarranty ?? []
      let technicalList = featureEn?.technicalInfo ?? []
      if (careList.length === 0 && technicalList.length === 0 && bmhome.descriptionHtml) {
        const extracted = extractFeatureLists(bmhome.descriptionHtml)
        careList = extracted.care
        technicalList = extracted.technical
      }

      const featureHead =
        featureEn?.head ||
        descriptionEn ||
        htmlToText(bmhome.shortHtml || bmhome.descriptionHtml || '')

      const taxonomyEn = {
        colors: colors.filter((c) => c.locale === 'en').map((c) => c.name),
        collections: collections.filter((c) => c.locale === 'en').map((c) => c.name),
        styles: styles.filter((c) => c.locale === 'en').map((c) => c.name),
      }
      const taxonomyRu = {
        colors: colors.filter((c) => c.locale === 'ru').map((c) => c.name),
        collections: collections.filter((c) => c.locale === 'ru').map((c) => c.name),
        styles: styles.filter((c) => c.locale === 'ru').map((c) => c.name),
      }

      if (
        !bmhome.descriptionHtml &&
        !bmhome.shortHtml &&
        !bmhome.technicalDetails &&
        careList.length === 0 &&
        technicalList.length === 0 &&
        taxonomyEn.colors.length === 0 &&
        taxonomyEn.collections.length === 0 &&
        taxonomyEn.styles.length === 0
      ) {
        skippedCount += 1
        continue
      }

      const baseDescription = descriptionEn || htmlToText(bmhome.descriptionHtml || bmhome.shortHtml || '')
      const forceOverwriteDesc = needsRuOverwrite(descriptionRu, baseDescription)
      const forceOverwriteHead = needsRuOverwrite(featureRu?.head, featureHead)
      const forceOverwriteCare = needsRuListOverwrite(featureRu?.careAndWarranty, careList)
      const forceOverwriteTechnical = needsRuListOverwrite(featureRu?.technicalInfo, technicalList)

      const currentHash = buildBmhomeTranslationHash({
        bmhome,
        featureHead,
        care: careList,
        technical: technicalList,
        taxonomy: taxonomyEn,
      })
      const existingHash = bmhome.translation?.enHash
      const hashChanged = !existingHash || existingHash !== currentHash
      const existingScopes = bmhome.translation?.scopes ?? {}
      const baseScopes: TranslationScopes = hashChanged ? {} : { ...existingScopes }

      const hasDescSource = Boolean(descriptionEn) || Boolean(bmhome.shortHtml) || Boolean(bmhome.descriptionHtml)
      const hasListSource = careList.length > 0 || technicalList.length > 0
      const hasTechSource =
        Array.isArray(bmhome.technicalDetails) && bmhome.technicalDetails.length > 0
      const techValuesEn = hasTechSource
        ? bmhome.technicalDetails?.map((detail) => detail.value ?? '').filter(Boolean) ?? []
        : []
      const techValuesRu = Array.isArray(bmhome.technicalDetailsRu)
        ? bmhome.technicalDetailsRu?.map((detail) => detail.value ?? '').filter(Boolean) ?? []
        : []
      const forceOverwriteTech = needsRuListOverwrite(techValuesRu, techValuesEn)
      const hasTaxonomySource =
        taxonomyEn.colors.length > 0 ||
        taxonomyEn.collections.length > 0 ||
        taxonomyEn.styles.length > 0

      const shouldDesc = translateDescriptions && hasDescSource && (forceOverwriteDesc || !descriptionRu)
      const shouldTech =
        translateTechnicalDetails &&
        hasTechSource &&
        (!bmhome.technicalDetailsRu || forceOverwriteTech)
      const shouldUpdateHead =
        translateDescriptions && (forceOverwriteHead || forceOverwriteDesc || !featureRu)
      const shouldUpdateCare =
        translateLists && hasListSource && (forceOverwriteCare || !featureRu)
      const shouldUpdateTechnicalList =
        translateLists && hasListSource && (forceOverwriteTechnical || !featureRu)
      const shouldLists = shouldUpdateCare || shouldUpdateTechnicalList
      const forceOverwriteTax =
        needsRuListOverwrite(taxonomyRu.colors, taxonomyEn.colors) ||
        needsRuListOverwrite(taxonomyRu.collections, taxonomyEn.collections) ||
        needsRuListOverwrite(taxonomyRu.styles, taxonomyEn.styles)
      const shouldTax = translateTaxonomy && hasTaxonomySource && forceOverwriteTax

      if (!shouldDesc && !shouldLists && !shouldTech && !shouldTax) {
        skippedCount += 1
        processedCount += 1
        if (processedCount % 10 === 0 || processedCount === products.length) {
          console.log(`PROGRESS done=${processedCount} total=${products.length} stage="skipping"`)
        }
        continue
      }

      const updates: Prisma.PrismaPromise<any>[] = []

      if (shouldDesc) {
        const ruDescription = await translateText(baseDescription, 'text')
        updates.push(
          prisma.description.upsert({
            where: { productId_locale: { productId: product.id, locale: 'ru' } },
            update: { description: ruDescription },
            create: { productId: product.id, locale: 'ru', description: ruDescription },
          })
        )
      }

      const shouldUpdateFeatures = shouldUpdateHead || shouldUpdateCare || shouldUpdateTechnicalList
      if (shouldUpdateFeatures) {
        const headBase = featureRu?.head || featureHead
        const careBase = featureRu?.careAndWarranty || careList
        const technicalBase = featureRu?.technicalInfo || technicalList
        const ruHead = shouldUpdateHead ? await translateText(featureHead, 'text') : headBase
        const ruCare = shouldUpdateCare
          ? await Promise.all(careList.map((item) => translateText(item, 'text')))
          : careBase
        const ruTechnical = shouldUpdateTechnicalList
          ? await Promise.all(technicalList.map((item) => translateText(item, 'text')))
          : technicalBase
        updates.push(
          prisma.feature.upsert({
            where: { productId_locale: { productId: product.id, locale: 'ru' } },
            update: {
              head: ruHead,
              careAndWarranty: ruCare,
              technicalInfo: ruTechnical,
            },
            create: {
              productId: product.id,
              locale: 'ru',
              head: ruHead,
              careAndWarranty: ruCare,
              technicalInfo: ruTechnical,
            },
          })
        )
      }

      const updatedBmhome: BmhomeMeta & Record<string, unknown> = {
        ...bmhome,
      }

      if (shouldDesc) {
        updatedBmhome.shortHtmlRu = await translateText(bmhome.shortHtml ?? '', 'html')
        updatedBmhome.descriptionHtmlRu = await translateText(bmhome.descriptionHtml ?? '', 'html')
      }

      if (shouldTech) {
        const technicalDetails = Array.isArray(bmhome.technicalDetails) ? bmhome.technicalDetails : []
        updatedBmhome.technicalDetailsRu = await Promise.all(
          technicalDetails.map(async (detail) => ({
            ...detail,
            value: detail.value ? await translateText(detail.value, 'text') : detail.value,
          }))
        )
      }

      if (shouldTax) {
        const colorEn = colors.find((c) => c.locale === 'en')
        const collectionEn = collections.find((c) => c.locale === 'en')
        const styleEn = styles.find((c) => c.locale === 'en')

        if (colorEn) {
          const ruName = await translateText(colorEn.name, 'text')
          updates.push(
            prisma.productColor.upsert({
              where: { productId_locale: { productId: product.id, locale: 'ru' } },
              update: { name: ruName, value: colorEn.value },
              create: { productId: product.id, locale: 'ru', name: ruName, value: colorEn.value },
            })
          )
        }
        if (collectionEn) {
          const ruName = await translateText(collectionEn.name, 'text')
          updates.push(
            prisma.productCollection.upsert({
              where: { productId_locale: { productId: product.id, locale: 'ru' } },
              update: { name: ruName, value: collectionEn.value },
              create: {
                productId: product.id,
                locale: 'ru',
                name: ruName,
                value: collectionEn.value,
              },
            })
          )
        }
        if (styleEn) {
          const ruName = await translateText(styleEn.name, 'text')
          updates.push(
            prisma.productStyle.upsert({
              where: { productId_locale: { productId: product.id, locale: 'ru' } },
              update: { name: ruName, value: styleEn.value },
              create: { productId: product.id, locale: 'ru', name: ruName, value: styleEn.value },
            })
          )
        }
      }

      const nextScopes: TranslationScopes = {
        descriptions: hashChanged ? false : Boolean(baseScopes.descriptions),
        technicalDetails: hashChanged ? false : Boolean(baseScopes.technicalDetails),
        lists: hashChanged ? false : Boolean(baseScopes.lists),
        taxonomy: hashChanged ? false : Boolean(baseScopes.taxonomy),
      }
      if (shouldDesc) nextScopes.descriptions = true
      if (shouldTech) nextScopes.technicalDetails = true
      if (shouldLists) nextScopes.lists = true
      if (shouldTax) nextScopes.taxonomy = true

      updatedBmhome.translation = {
        ...(bmhome.translation ?? {}),
        enHash: currentHash,
        updatedAt: new Date().toISOString(),
        mode: translateMode,
        scopes: nextScopes,
      }

      const updatedSourceMeta = {
        ...sourceMeta,
        bmhome: updatedBmhome,
      } as Prisma.InputJsonValue

      updates.push(
        prisma.product.update({
          where: { id: product.id },
          data: { sourceMeta: updatedSourceMeta },
        })
      )

      if (updates.length > 0) {
        await prisma.$transaction(updates)
      }

      translatedCount += 1
      processedCount += 1
      if (processedCount % 10 === 0 || processedCount === products.length) {
        console.log(`PROGRESS done=${processedCount} total=${products.length} stage="translating"`)
      }
    } catch (error) {
      errorCount += 1
      console.error(`Failed to translate ${product.productCode}:`, (error as Error).message)
      processedCount += 1
      if (processedCount % 10 === 0 || processedCount === products.length) {
        console.log(`PROGRESS done=${processedCount} total=${products.length} stage="error"`)
      }
    }
  }

  console.log('BMHOME RU translation finished.')
  console.log(`Translated: ${translatedCount}, skipped: ${skippedCount}, errors: ${errorCount}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
