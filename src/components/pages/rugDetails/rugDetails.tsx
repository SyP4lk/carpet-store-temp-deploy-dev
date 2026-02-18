"use client";

import { RugProduct } from "@/types/product";
import { FC, useState, useMemo } from "react";
import { ChevronDown, Heart } from "lucide-react";
import { Locale } from "@/localization/config";
import { useDictionary } from "@/hooks/useDictionary";
import AdminStockButton from "@/components/admin/AdminStockButton";
import { formatPrice } from "@/lib/currency";
import { useCurrency } from "@/context/CurrencyContext";
import { useSearchParams } from "next/navigation";
import { calculateRugPrice } from "@/lib/calculatePrice";
import { toast } from "sonner";
import { StockProvider } from "@/context/StockContext";
import { getBmhomeVariantPriceEur, getDisplaySku, getPriceOnRequestLabel, isBmhomeSpecialSizeSelected, isPriceOnRequestProduct } from "@/lib/productUtils";

type Props = {
  rug: RugProduct;
  locale: Locale
};


const RugDetails: FC<Props> = ({ rug, locale }) => {
  const searchParams = useSearchParams();

const selectedSize = useMemo(() => {
  try {
    const sizeParam = searchParams?.get("size");
    const widthParam = searchParams?.get("width");
    const heightParam = searchParams?.get("height");

    let s = rug.defaultSize || rug.sizes[0] || "";

    if (sizeParam) {
      s = sizeParam;
    } else if (widthParam && heightParam) {
      s = `${widthParam} x ${heightParam} cm`;
    }

    return s;
  } catch {
    return rug.defaultSize || rug.sizes?.[0] || "";
  }
}, [rug.defaultSize, rug.sizes, searchParams]);

const stockCode = useMemo(() => getDisplaySku(rug, selectedSize) || "N/A", [rug, selectedSize]);

  const description = rug.description?.[locale] || "";
  const name = rug.product_name?.[locale] || "Unnamed Product";
  const features = rug.features?.[locale];
  const {dictionary} = useDictionary();
  const { eurToRubRate } = useCurrency();
  const isBmhome = !!rug.sourceMeta?.bmhome;
  const specialSizeSelected = isBmhome && isBmhomeSpecialSizeSelected(rug, selectedSize);
  const priceOnRequest = isPriceOnRequestProduct(rug) || specialSizeSelected;

  const [open, setOpen] = useState(false);

  const basePrice = typeof rug.price === 'string' ? parseFloat(rug.price.replace(/,/g, '')) : (rug.price || 0);

  const currentPriceEur = useMemo(() => {
    if (priceOnRequest) return 0;

    if (isBmhome) {
      const vPrice = getBmhomeVariantPriceEur(rug, selectedSize);
      return vPrice ?? basePrice;
    }

    if (!basePrice || !rug.sizes?.length) return basePrice;

    try {
      return calculateRugPrice(basePrice, rug.sizes, selectedSize);
    } catch (error) {
      console.error('Error calculating price:', error);
      return basePrice;
    }
  }, [basePrice, rug, selectedSize, priceOnRequest, isBmhome]);



  return (
    <StockProvider productCodes={[rug.product_code]}>
      <div className="flex flex-col gap-4 pb-5 mb-5 border-b">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl uppercase">{name}</h1>
        <button className="cursor-pointer">
          <Heart className="w-6 h-6 text-gray-400" />
        </button>
      </div>
      <p className="text-sm text-gray-600 font-semibold cursor-pointer" onClick={() => {
        navigator.clipboard.writeText(stockCode);
        toast.success(dictionary?.shared.copiedToClipboard || 'Артикул скопирован!');
      }}>
        {dictionary?.shared.sku || "SKU"}: {stockCode}
      </p>
      <p className="text-xs text-gray-500 -mt-3">
        {locale === "ru" ? "Нажмите на артикул, чтобы скопировать" : "Click the SKU to copy"}
      </p>
      <p className="text-sm text-gray-700">{dictionary?.shared.produced}</p>
      <p className="text-base text-gray-800 leading-relaxed font-semibold">
        {priceOnRequest ? getPriceOnRequestLabel(locale) : formatPrice(currentPriceEur, locale, eurToRubRate)}
      </p>
      <p className="text-base text-gray-800 leading-relaxed">{description}</p>

      <AdminStockButton productCode={rug.product_code} className="w-full sm:w-auto" />

      <div data-open={open} className="group grid grid-rows-[auto_0] data-[open=true]:grid-rows-[auto_1fr] overflow-hidden transition-all duration-300">
        <div className="flex justify-between items-center cursor-pointer" onClick={() => setOpen(!open)} >
          <h2 className="text-lg font-semibold mb-2">{dictionary?.shared.features}</h2>
          <button >
            <ChevronDown className="size-6 group-data-[open=true]:rotate-180 transition-all duration-300" />
          </button>
        </div>

        <div className="space-y-6 py-4">
          {/* Main description */}
          <p className="text-sm text-gray-700 leading-relaxed">{features?.head}</p>

          {/* Care and Warranty Section */}
          {features?.care_and_warranty && features.care_and_warranty.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-bold text-gray-900 uppercase tracking-wide">
                {dictionary?.shared.careAndWarranty}
              </h3>
              <ul className="space-y-2 text-sm text-gray-700">
                {features.care_and_warranty.map((item, index) => (
                  <li key={index} className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Technical Information Section */}
          {features?.technical_info && features.technical_info.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-bold text-gray-900 uppercase tracking-wide">
                {dictionary?.shared.technicalInfo}
              </h3>
              <ul className="space-y-2 text-sm text-gray-700">
                {features.technical_info.map((item, index) => (
                  <li key={index} className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      </div>
    </StockProvider>
  );
};

export default RugDetails;
