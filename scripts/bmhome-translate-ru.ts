import { PrismaClient, ProductSource } from '@prisma/client'
import { load } from 'cheerio'
import { createHash } from 'node:crypto'
import 'dotenv/config'

type TechnicalDetail = {
  key?: string
  value?: string
}

type BmhomeMeta = {
  shortHtml?: string | null
  descriptionHtml?: string | null
  technicalDetails?: TechnicalDetail[]
  translation?: {
    enHash?: string
    updatedAt?: string
    mode?: string
  }
}

const prisma = new PrismaClient()
const translateUrlRaw = process.env.BMHOME_TRANSLATE_URL?.trim()
const translateEndpoint = translateUrlRaw
  ? translateUrlRaw.endsWith('/translate')
    ? translateUrlRaw
    : `${translateUrlRaw.replace(/\/$/, '')}/translate`
  : null

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

function buildBmhomeTranslationHash(data: BmhomeMeta): string {
  const payload = JSON.stringify({
    shortHtml: data.shortHtml ?? '',
    descriptionHtml: data.descriptionHtml ?? '',
    technicalDetails:
      data.technicalDetails?.map((detail) => ({
        key: detail.key ?? '',
        value: detail.value ?? '',
      })) ?? [],
  })
  return createHash('sha256').update(payload).digest('hex')
}

async function main() {
  console.log('BMHOME RU translation started.')
  console.log(`Translator: ${translateEndpoint ? translateEndpoint : 'glossary-only'}`)

  const products = await prisma.product.findMany({
    where: { source: ProductSource.BMHOME },
    select: {
      id: true,
      productCode: true,
      sourceMeta: true,
    },
  })

  let translatedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const product of products) {
    try {
      const sourceMeta = (product.sourceMeta ?? {}) as Record<string, any>
      const bmhome = (sourceMeta.bmhome ?? {}) as BmhomeMeta
      if (!bmhome.descriptionHtml && !bmhome.shortHtml && !bmhome.technicalDetails) {
        skippedCount += 1
        continue
      }

      const currentHash = buildBmhomeTranslationHash(bmhome)
      const existingHash = bmhome.translation?.enHash
      if (existingHash && existingHash === currentHash) {
        skippedCount += 1
        continue
      }

      const descriptionHtml = bmhome.descriptionHtml || ''
      const shortHtml = bmhome.shortHtml || ''
      const descriptionText = htmlToText(descriptionHtml || shortHtml || '')
      const shortText = htmlToText(shortHtml || descriptionHtml || '')
      const featureHead = shortText || descriptionText
      const { care, technical } = extractFeatureLists(descriptionHtml || '')
      const technicalDetails = Array.isArray(bmhome.technicalDetails) ? bmhome.technicalDetails : []

      const ruDescription = translateEndpoint ? await translateText(descriptionText, 'text') : descriptionText
      const ruHead = translateEndpoint ? await translateText(featureHead, 'text') : featureHead

      const ruCare = await Promise.all(care.map((item) => translateText(item, 'text')))
      const ruTechnical = await Promise.all(technical.map((item) => translateText(item, 'text')))

      const ruTechnicalDetails = await Promise.all(
        technicalDetails.map(async (detail) => ({
          ...detail,
          value: detail.value ? await translateText(detail.value, 'text') : detail.value,
        }))
      )

      const ruShortHtml = translateEndpoint ? await translateText(shortHtml, 'html') : shortHtml
      const ruDescriptionHtml = translateEndpoint ? await translateText(descriptionHtml, 'html') : descriptionHtml

      const updatedBmhome: BmhomeMeta & Record<string, unknown> = {
        ...bmhome,
        shortHtmlRu: ruShortHtml,
        descriptionHtmlRu: ruDescriptionHtml,
        technicalDetailsRu: ruTechnicalDetails,
        translation: {
          enHash: currentHash,
          updatedAt: new Date().toISOString(),
          mode: translateEndpoint ? 'libretranslate' : 'glossary',
        },
      }

      const updatedSourceMeta = {
        ...sourceMeta,
        bmhome: updatedBmhome,
      }

      await prisma.$transaction([
        prisma.product.update({
          where: { id: product.id },
          data: { sourceMeta: updatedSourceMeta },
        }),
        prisma.description.upsert({
          where: { productId_locale: { productId: product.id, locale: 'ru' } },
          update: { description: ruDescription },
          create: { productId: product.id, locale: 'ru', description: ruDescription },
        }),
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
        }),
      ])

      translatedCount += 1
      if (translatedCount % 50 === 0) {
        console.log(`Translated ${translatedCount}/${products.length}`)
      }
    } catch (error) {
      errorCount += 1
      console.error(`Failed to translate ${product.productCode}:`, (error as Error).message)
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
