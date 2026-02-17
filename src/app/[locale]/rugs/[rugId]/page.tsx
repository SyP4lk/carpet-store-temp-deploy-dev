import RugColors from "@/components/pages/rugDetails/rugColors";
import RugDetails from "@/components/pages/rugDetails/rugDetails";
import RugImages from "@/components/pages/rugDetails/rugImages";
import RugSize from "@/components/pages/rugDetails/rugSizes";
import RugQuantityAddToCart from "@/components/pages/rugDetails/rugQuantity";
import RugRecommendations from "@/components/pages/rugDetails/rugRecommendations";
import Banner from "@/components/shared/banner";
import { FC, Suspense } from "react";
import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";
import type { Metadata } from "next";
import { Locale } from "@/localization/config";
import { getDictionary } from "@/localization/dictionary";
import Footer from "@/components/shared/footer";
import { getProductById, getAllProducts } from "@/lib/products";
import { getRecommendations } from "@/lib/recommendations";

type ProductDetailsProps = {
  params: Promise<{ locale: Locale; rugId: string }>;
};
export const dynamic = "force-dynamic";
const ProductDetails: FC<ProductDetailsProps> = async ({ params }) => {
  noStore();
  const pathParams = await params;
  const locale = pathParams.locale;
  const rugId = pathParams.rugId;
  const dictionary = await getDictionary(locale);

  const currentRug = await getProductById(Number(rugId));
  const collectionLabel = currentRug?.collection?.[locale] || "";

  // Early return if rug not found
  if (!currentRug) {
    return (
      <>
        <Banner
          filter={dictionary.shared.notFound}
          image="/static/image1.png"
        />
        <Footer />
      </>
    );
  }

  const allProducts = await getAllProducts();
  const relatedProducts = allProducts.filter(
    (rug) =>
      rug.product_name?.[locale]?.split(" ")?.[0] ===
      currentRug.product_name?.[locale]?.split(" ")?.[0]
  );

  // Получаем рекомендации на основе цветов ниток и цены (до 300 уникальных товаров без дубликатов)
  const recommendations = getRecommendations(currentRug, allProducts, 300);

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://koenigcarpet.ru";
  const productName = currentRug.product_name?.[locale];
  const description = currentRug.description?.[locale];

  return (
    <>
      <Banner
        filter={dictionary.shared.rugDetail}
        image="/static/image1.png"
        subtitle={collectionLabel || undefined}
      />
      <div className="flex flex-col md:flex-row">
        <div className="w-full md:w-2/5 p-2">
          <RugImages
            rug={currentRug}
            locale={locale}
            relatedProducts={relatedProducts}
          />
        </div>
        <div className="flex-1 p-10">
          <div className="sticky top-16">
            <Suspense fallback={<div>Loading...</div>}>
              <RugDetails rug={currentRug} locale={locale} />
              <RugColors rugs={relatedProducts} locale={locale} />
              <RugSize rug={currentRug} />
              <RugQuantityAddToCart rug={currentRug} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Блок рекомендаций */}
      <RugRecommendations
        recommendations={recommendations}
        locale={locale}
      />

      {/* ✅ Product JSON-LD Schema */}
      {productName && description && currentRug.images && Array.isArray(currentRug.images) && (
        <Script
          id="product-schema"
          type="application/ld+json"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org/",
              "@type": "Product",
              name: productName,
              image: currentRug.images
                .filter(img => typeof img === 'string' && img.length > 0)
                .map((img) => 
                  img.startsWith("http") ? img : `${baseUrl}${img}`
                ),
              description: description,
              sku: currentRug.id,
              brand: {
                "@type": "Brand",
                name: "Koenig Carpet",
              },
              offers: {
                "@type": "Offer",
                url: `${baseUrl}/${locale}/rugs/${rugId}`,
                priceCurrency: "RUB",
                price: currentRug.price || 0,
                availability: "https://schema.org/InStock",
              },
            }),
          }}
        />
      )}

      {/* ✅ Breadcrumb JSON-LD Schema */}
      {productName && (
        <Script
          id="breadcrumb-schema"
          type="application/ld+json"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Home",
                  item: `${baseUrl}/${locale}`,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Rugs",
                  item: `${baseUrl}/${locale}/rugs`,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: productName,
                  item: `${baseUrl}/${locale}/rugs/${rugId}`,
                },
              ],
            }),
          }}
        />
      )}

      <Footer />
    </>
  );
};

export default ProductDetails;

export async function generateMetadata({
  params,
}: ProductDetailsProps): Promise<Metadata> {
  noStore();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://koenigcarpet.ru";
  const pathParams = await params;
  const locale = pathParams.locale;
  const rugId = pathParams.rugId;
  const rug = await getProductById(Number(rugId));

  if (!rug) {
    return {
      title: "Product Not Found | Carpet Store",
      description: "The requested rug could not be found.",
      keywords: ["rug", "carpet", "product not found"],
    };
  }

  const productName = rug.product_name?.[locale] || "Unnamed Product";
  const description = rug.description?.[locale] || "No description available";
  const ogImage = rug.images?.[0] || "/static/default-rug.jpg";

  // Safely build keywords array
  const keywords = [
    rug.product_name?.[locale],
    rug.collection?.[locale],
    rug.style?.[locale],
    rug.description?.[locale],
    ...(rug.features?.[locale]?.technical_info || []),
    ...(rug.features?.[locale]?.care_and_warranty || []),
    ...(rug.sizes || []),
  ].filter(Boolean).join(", ");

  return {
    title: productName,
    description,
    keywords,
    openGraph: {
      title: productName,
      description,
      url: `${baseUrl}/${locale}/rugs/${rugId}`,
      siteName: "Koenig Carpet",
      images: [
        {
          url: ogImage.startsWith("http") ? ogImage : `${baseUrl}${ogImage}`,
          width: 1200,
          height: 630,
          alt: productName,
        },
      ],
      type: "website",
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title: productName,
      description,
      images: [
        ogImage.startsWith("http") ? ogImage : `${baseUrl}${ogImage}`,
      ],
    },
    alternates: {
      canonical: `${baseUrl}/${locale}/rugs/${rugId}`,
    },
  };
}

export async function generateStaticParams() {
  // force-dynamic disables prerendering for this route.
  // Keep static params empty to avoid build-time generation for the whole catalog.
  return [];
}

// Not required with force-dynamic, kept explicit to allow any rugId.
export const dynamicParams = true;

// ISR and prerender cache are intentionally disabled for this route
// to prevent unbounded .next cache growth on production.
