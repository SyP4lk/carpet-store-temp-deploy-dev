import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function verifyFeatures() {
  console.log('Checking features in database...\n')

  // Get first product with features
  const product = await prisma.product.findFirst({
    include: {
      productNames: true,
      features: true,
    },
  })

  if (!product) {
    console.log('❌ No products found in database')
    return
  }

  console.log('✅ Product found:', product.productNames[0]?.name)
  console.log('\n=== Features Data ===')

  product.features.forEach((feature: any) => {
    console.log(`\n📍 Locale: ${feature.locale}`)
    console.log(`📝 Head: ${feature.head.substring(0, 100)}...`)
    console.log(`🛠️  Care & Warranty items: ${feature.careAndWarranty.length}`)
    console.log(`📋 Technical Info items: ${feature.technicalInfo.length}`)

    if (feature.careAndWarranty.length > 0) {
      console.log(`   First care item: ${feature.careAndWarranty[0]}`)
    }

    if (feature.technicalInfo.length > 0) {
      console.log(`   First tech item: ${feature.technicalInfo[0]}`)
    }
  })

  // Count total
  const totalProducts = await prisma.product.count()
  const totalFeatures = await prisma.feature.count()

  console.log('\n=== Summary ===')
  console.log(`Total products: ${totalProducts}`)
  console.log(`Total features (should be ${totalProducts * 3}): ${totalFeatures}`)
}

verifyFeatures()
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
