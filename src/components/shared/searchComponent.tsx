"use client";

import { useState, useEffect, useRef } from "react";
import { X, Search, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { RugProduct } from "@/types/product";
import { Locale } from "@/localization/config";
import useDrawerStore from "@/hooks/useDrawerStore";
import { useDictionary } from "@/hooks/useDictionary";
import LazyImage from "./lazyImage";
import nProgress from "nprogress";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/currency";
import { useCurrency } from "@/context/CurrencyContext";
import { calculateRugPrice } from "@/lib/calculatePrice";
import { getPriceOnRequestLabel, isPriceOnRequestProduct } from "@/lib/productUtils";

interface SearchComponentProps {
  locale: Locale;
}

const SearchComponent: React.FC<SearchComponentProps> = ({ locale }) => {
  const { searchComp, close } = useDrawerStore();
  const { dictionary } = useDictionary();
  const { eurToRubRate } = useCurrency();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<RugProduct[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<RugProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debouncedQuery = useDebounce(query, 400);
  const router = useRouter();

  useEffect(() => {
    if (searchComp && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [searchComp]);

  useEffect(() => {
    const fetchData = async () => {
      if (!debouncedQuery.trim()) {
        setProducts([]);
        setCategories([]);
        setFilteredProducts([]);
        setSelectedCategory(null);
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(debouncedQuery)}`, {
          headers: {"accept-language": locale}
        });
        const data = await res.json();

        if (res.ok) {
          const prods: RugProduct[] = data.products || [];
          setProducts(prods);

          const uniqueColors = Array.from(
            new Set(prods.map((p) => p.color?.[locale]).filter(Boolean))
          );
          setCategories(uniqueColors);

          setFilteredProducts(prods);
          setSelectedCategory(null);
        }
      } catch (err) {
        console.error("Search error:", err);
        setProducts([]);
        setCategories([]);
        setFilteredProducts([]);
        setSelectedCategory(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [debouncedQuery, locale]);

  // Filterlash logikasi
  useEffect(() => {
    if (selectedCategory) {
      setFilteredProducts(
        products.filter((p) => p.color?.[locale] === selectedCategory)
      );
    } else if (hoveredCategory) {
      setFilteredProducts(
        products.filter((p) => p.color?.[locale] === hoveredCategory)
      );
    } else {
      setFilteredProducts(products);
    }
  }, [products, hoveredCategory, selectedCategory, locale]);

  // Input boshqaruvi
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleClose();
    }
  };

  const handleClose = () => {
    close("searchComp");
    setQuery("");
    setProducts([]);
    setCategories([]);
    setFilteredProducts([]);
    setSelectedCategory(null);
    setHoveredCategory(null);
  };

  if (!searchComp) return null;

  const handleProductClick = (product: RugProduct) => {
    nProgress.start();
    close("searchComp");
    router.push(`/${locale}/rugs/${product.id}`);
  };

  // Функция для расчета цены с учетом defaultSize (как в ProductCard)
  const getDisplayPrice = (product: RugProduct): number => {
    const basePrice = typeof product.price === 'string'
      ? parseFloat(product.price.replace(/,/g, ''))
      : (product.price || 0);

    // Если есть размеры и defaultSize, рассчитываем цену для defaultSize
    if (product.sizes && product.sizes.length > 0 && product.defaultSize) {
      return calculateRugPrice(basePrice, product.sizes, product.defaultSize);
    }

    // Иначе возвращаем базовую цену
    return basePrice;
  };

  return (
    <>

      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity duration-300 cursor-pointer"
        style={{ touchAction: 'none' }}
        onClick={(e) => {
          e.stopPropagation();
          close("searchComp");
        }}
      />


      <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 px-2 sm:pt-16 sm:px-4">
        <div className="bg-white w-full max-w-4xl rounded-xl shadow-2xl transform transition-all duration-300 scale-100 opacity-100 animate-in fade-in slide-in-from-top-4">

          <div className="relative border-b border-gray-100">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              ref={inputRef}
              type="text"
              placeholder={dictionary?.searchComp.placeholder}
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="w-full pl-12 pr-12 py-3 sm:py-4 bg-transparent outline-none text-base sm:text-lg placeholder:text-gray-400 focus:placeholder:text-gray-300 transition-colors"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleClose();
              }}
              className="absolute cursor-pointer right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>


          {query.trim() && (
            <div
              className="flex flex-col sm:flex-row bg-white overflow-hidden rounded-b-xl max-h-[75vh] sm:max-h-[70vh]"
              onMouseLeave={() => setHoveredCategory(null)} // faqat umumiy zonadan chiqsa tozalansin
            >

              {categories.length > 0 && (
                <div className="w-full sm:w-44 border-b sm:border-b-0 sm:border-r border-gray-100 bg-gray-50/50 overflow-y-auto">
                  <div className="p-3 sm:p-4">
                    <h3 className="font-semibold text-gray-700 mb-3 text-xs sm:text-sm uppercase tracking-wider">
                      {dictionary?.searchComp.colors}
                    </h3>

                    <ul className="flex sm:block gap-2 sm:gap-0 overflow-x-auto sm:overflow-visible snap-x">
                      {categories.map((color) => (
                        <li
                          key={color}
                          className={`px-3 py-2 text-xs sm:text-sm cursor-pointer rounded-lg whitespace-nowrap transition-all duration-200 snap-start ${selectedCategory === color
                            ? "bg-blue-500 text-white font-medium shadow-sm"
                            : hoveredCategory === color
                              ? "bg-blue-100 text-blue-700 font-medium shadow-sm"
                              : "text-gray-600 hover:bg-white hover:shadow-sm"
                            }`}
                          onMouseEnter={() => setHoveredCategory(color)}
                          onClick={() => setSelectedCategory(color)}
                        >
                          {color}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}


              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
                      <p className="text-gray-500 text-sm">
                        {dictionary?.searchComp.searching}
                      </p>
                    </div>
                  </div>
                ) : filteredProducts.length > 0 ? (
                  <div className="p-3 sm:p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {filteredProducts.map((product) => (
                        <div
                          key={product.id}
                          className="group flex gap-3 sm:gap-4 bg-white border border-gray-100 rounded-xl p-3 sm:p-4 hover:border-gray-200 hover:shadow-md transition-all duration-200 cursor-pointer"
                          onClick={() => handleProductClick(product)}
                        >

                          <div className="flex-shrink-0">
                            <LazyImage
                              width={1080}
                              height={1550}
                              src={
                                product.images?.[0] || "/placeholder-rug.jpg"
                              }
                              alt={
                                product.product_name[locale] || "Product"
                              }
                              className="w-16 h-24 sm:w-20 sm:h-28 object-cover rounded-lg shadow-sm group-hover:shadow-md transition-shadow duration-200"
                            />
                          </div>


                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            {product.color?.[locale] && (
                              <div className="mb-2">
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-medium bg-gray-100 text-gray-700">
                                  {product.color[locale]}
                                </span>
                              </div>
                            )}

                            <h4 className="font-medium text-gray-900 text-xs leading-tight mb-2 line-clamp-2">
                              {product.product_name?.[locale] ||
                                dictionary?.searchComp.unnamedProduct}
                            </h4>

                            <div className="mt-auto">
                              <span className="text-xs font-semibold text-blue-600">
                                {isPriceOnRequestProduct(product)
                                  ? getPriceOnRequestLabel(locale)
                                  : formatPrice(getDisplayPrice(product), locale, eurToRubRate)}
                              </span>
                            </div>
                          </div>


                          <div className="flex-shrink-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center">
                              <svg
                                className="w-3 h-3 text-blue-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-400 p-4">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                      <Search className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-sm text-center">
                      {dictionary?.searchComp.noProducts.replace(
                        "{query}",
                        query
                      )}
                    </p>
                    <p className="text-xs mt-1 text-center">
                      {dictionary?.searchComp.tryDifferent}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}


          {!query.trim() && (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <Search className="w-8 h-8 mb-2" />
              <p className="text-sm text-center px-4">
                {dictionary?.searchComp.startTyping}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SearchComponent;
