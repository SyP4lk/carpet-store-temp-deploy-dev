import { prisma } from './prisma'
import { resolveCatalogSource } from './bmhomeSync'
import { RugProduct } from '@/types/product'
import { rewriteTicimaxImageUrl } from "./ticimaxImages";

export async function getAllProducts(): Promise<RugProduct[]> {
  const { where: sourceWhere } = await resolveCatalogSource()
  const products = await prisma.product.findMany({
    where: {
      ...(sourceWhere ?? {}),
      // Исключаем товары без цены
      price: {
        not: ''
      }
    },
    include: {
      productNames: true,
      descriptions: true,
      features: true,
      colors: true,
      collections: true,
      styles: true,
    },
  })

  // Дополнительная фильтрация на уровне приложения для товаров с ценой "0"
  return products.map(transformProduct);
}

export async function getProductById(id: number): Promise<RugProduct | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      productNames: true,
      descriptions: true,
      features: true,
      colors: true,
      collections: true,
      styles: true,
    },
  })

  return product ? transformProduct(product) : null
}

export async function getProductByCode(code: string): Promise<RugProduct | null> {
  const product = await prisma.product.findUnique({
    where: { productCode: code },
    include: {
      productNames: true,
      descriptions: true,
      features: true,
      colors: true,
      collections: true,
      styles: true,
    },
  })

  return product ? transformProduct(product) : null
}

export async function getProductsByFilter(filter: {
  inStock?: boolean
  isNew?: boolean
  isRunners?: boolean
  collection?: string
  style?: string
  color?: string
}): Promise<RugProduct[]> {
  const { where: sourceWhere } = await resolveCatalogSource()
  const where: any = {
    ...(sourceWhere ?? {}),
    price: { not: '' },
  }

  if (filter.inStock !== undefined) where.inStock = filter.inStock
  if (filter.isNew !== undefined) where.isNew = filter.isNew
  if (filter.isRunners !== undefined) where.isRunners = filter.isRunners

  if (filter.collection) {
    where.collections = {
      some: {
        value: filter.collection
      }
    }
  }

  if (filter.style) {
    where.styles = {
      some: {
        value: filter.style
      }
    }
  }

  if (filter.color) {
    where.colors = {
      some: {
        value: filter.color
      }
    }
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      productNames: true,
      descriptions: true,
      features: true,
      colors: true,
      collections: true,
      styles: true,
    },
  })

  return products.map(transformProduct);
}

function transformProduct(product: any): RugProduct {
  const getName = (locale: string) =>
    product.productNames.find((n: any) => n.locale === locale)?.name || ''
  const getDesc = (locale: string) =>
    product.descriptions.find((d: any) => d.locale === locale)?.description || ''
  const getFeature = (locale: string) => {
    const feature = product.features.find((f: any) => f.locale === locale)
    return {
      head: feature?.head || '',
      care_and_warranty: feature?.careAndWarranty || [],
      technical_info: feature?.technicalInfo || []
    }
  }
  const getColor = (locale: string) =>
    product.colors.find((c: any) => c.locale === locale)?.name || ''
  const getCollection = (locale: string) =>
    product.collections.find((c: any) => c.locale === locale)?.name || ''
  const getStyle = (locale: string) =>
    product.styles.find((s: any) => s.locale === locale)?.name || ''

  return {
    id: product.id,
    product_code: product.productCode,
    product_name: {
      en: getName('en'),
      ru: getName('ru')
    },
    description: {
      en: getDesc('en'),
      ru: getDesc('ru')
    },
    features: {
      en: getFeature('en'),
      ru: getFeature('ru')
    },
    color: {
      en: getColor('en'),
      ru: getColor('ru'),
      value: product.colors[0]?.value || ''
    },
    collection: {
      en: getCollection('en'),
      ru: getCollection('ru'),
      value: product.collections[0]?.value || ''
    },
    style: {
      en: getStyle('en'),
      ru: getStyle('ru'),
      value: product.styles[0]?.value || ''
    },
    price: product.price,
    sizes: product.sizes,
    defaultSize: product.defaultSize || undefined,
    images: Array.isArray(product.images) ? product.images.map(rewriteTicimaxImageUrl) : [],
    isNew: product.isNew,
    isRunners: product.isRunners,
    inStock: product.inStock,
    sourceMeta: product.sourceMeta ?? undefined
  }
}
