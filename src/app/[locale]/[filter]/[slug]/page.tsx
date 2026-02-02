import FilterProduct from '@/components/shared/filterProduct'
import Banner from '@/components/shared/banner'
import Footer from '@/components/shared/footer'
import ProductControl from '@/components/shared/productControl'
import { Locale, localeConfig } from '@/localization/config'
import { FC, Suspense } from 'react'
import { RugProduct } from '@/types/product'
import { filterProducts } from "@/lib/filterProduct";
import { generateFilterData } from "@/lib/generateFilterData";
import { getDictionary } from "@/localization/dictionary"
import { getAllProducts } from "@/lib/products"


type FilteredRugsProps = {
  params: Promise<{ locale: Locale, filter:"color" | "style" | "collection", slug: string }>
  searchParams: Promise<Record<string, string>>
}

const FilteredRugs: FC<FilteredRugsProps> = async ({ params, searchParams }) => {

  const urlSearchParams = await searchParams;
  const pathParams = await params
  const dict = await getDictionary(pathParams.locale)
  const data = await getAllProducts();
  const filteredRugs = filterProducts(data, urlSearchParams, pathParams.filter, pathParams.slug);
  

  const pageRaw = urlSearchParams.page;
  const perPageRaw = urlSearchParams.perPage;
  
  const perPage = Math.max(1, Math.min(parseInt(perPageRaw as string) || 12, 200));
  const currentPage = Math.max(1, parseInt(pageRaw as string) || 1);
  
  const start = (currentPage - 1) * perPage;
  const end = start + perPage;
  const displayedRugs = filteredRugs.slice(start, end);

  const filterData=generateFilterData(data, pathParams.locale, dict)

  const selectedFromData =
    pathParams.filter === 'collection'
      ? filteredRugs[0]?.collection?.[pathParams.locale]
      : pathParams.filter === 'style'
        ? filteredRugs[0]?.style?.[pathParams.locale]
        : filteredRugs[0]?.color?.[pathParams.locale]
  const selectedValue = selectedFromData || decodeURIComponent(pathParams.slug)
  const filterLabel =
    pathParams.filter === 'collection'
      ? dict.shared.collections || 'Collection'
      : pathParams.filter === 'style'
        ? dict.shared.styles || 'Style'
        : dict.shared.colors || 'Color'
  const bannerTitle = `${filterLabel} - ${selectedValue}`

  return (
    <div>
      <Banner filter={decodeURIComponent(pathParams.filter)} image={"/static/image1.png"} title={bannerTitle} />
            <Suspense fallback={null}>
              <ProductControl />
            </Suspense>

      <FilterProduct
        searchParams={urlSearchParams}
        rugs={displayedRugs}
        rugsCount={filteredRugs.length}
        filterData={filterData}

      />
      <Footer />
    </div>
  )
}

export default FilteredRugs


export const generateStaticParams = async () => {
  const data = (await import("@/context/data.json")).default as RugProduct[];

  const paramsSet = new Set<string>();
  const params: { filter: string; slug: string }[] = [];

  localeConfig.locales.map((locale) => {
      data.forEach((rug) => {
    const entries: [string, string | string[]][] = [
      ["color", rug.color[locale]],
      ["style", rug.style[locale]],
      ["collection", rug.collection[locale]],
    ];

    entries.forEach(([filter, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => {
          const key = `${filter}-${v}`;
          if (!paramsSet.has(key)) {
            paramsSet.add(key);
            params.push({ filter, slug: v });
          }
        });
      } else if (value) {
        const key = `${filter}-${value}`;
        if (!paramsSet.has(key)) {
          paramsSet.add(key);
          params.push({ filter, slug: value });
        }
      }
    });
  });
  })

  return params;
};
