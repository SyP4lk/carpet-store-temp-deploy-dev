"use client";

import { Heart } from "lucide-react";
import { FC, useState, useRef, useEffect, useMemo } from "react";
import LazyImage from "./lazyImage";
import { RugProduct } from "@/types/product";
import { useRouter } from "next/navigation";
import { useLocale } from "@/hooks/useLocale";
import nProgress from "nprogress";
import { useCartStore } from '@/hooks/useCartStore';
import AdminStockButton from '@/components/admin/AdminStockButton';
import { formatPrice } from '@/lib/currency';
import { useCurrency } from '@/context/CurrencyContext';
import { calculateRugPrice } from '@/lib/calculatePrice';
import { getPriceOnRequestLabel, getRequestPriceCta, isPriceOnRequestProduct } from '@/lib/productUtils';

type Props = {
  product: RugProduct;
};

const ProductCard: FC<Props> = ({ product }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [currentColorIndex] = useState(0);
  const [preloadedImages, setPreloadedImages] = useState<Set<number>>(new Set([0]));
  const preloadTriggered = useRef(false);
  const router = useRouter();
  const [locale] = useLocale();
  const {addToCart} = useCartStore();
  const { eurToRubRate } = useCurrency();
  const priceOnRequest = isPriceOnRequestProduct(product);

  // Рассчитываем цену для размера по умолчанию
  const displayPrice = useMemo(() => {
    const basePrice = typeof product.price === 'string'
      ? parseFloat(product.price.replace(/,/g, ''))
      : (product.price || 0);

    // Если есть размеры и defaultSize, рассчитываем цену для defaultSize
    if (product.sizes && product.sizes.length > 0 && product.defaultSize) {
      return calculateRugPrice(basePrice, product.sizes, product.defaultSize);
    }

    // Иначе возвращаем базовую цену
    return basePrice;
  }, [product.price, product.sizes, product.defaultSize]);


  useEffect(() => {
    if (hoveredIndex !== null && !preloadTriggered.current) {
      preloadTriggered.current = true;
      product.images.forEach((_, idx) => {
        if (idx > 0) {
          setTimeout(() => {
            setPreloadedImages(prev => new Set(prev).add(idx));
          }, idx * 100); 
        }
      });
    }
  }, [hoveredIndex, product.images]);

  useEffect(() => {
    setPreloadedImages(new Set([0]));
    preloadTriggered.current = false;
    setHoveredIndex(null);
  }, [currentColorIndex]);

  const handleMouseEnterArea = (idx: number) => {
    setHoveredIndex(idx);
    if (!preloadedImages.has(idx)) {
      setPreloadedImages(prev => new Set(prev).add(idx));
    }
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };

  const getActiveImageIndex = () => {
    return hoveredIndex !== null ? hoveredIndex : 0;
  };

  const navigateToDetails = () => {
    nProgress.start()
    router.push(`/${locale}/rugs/${product.id}`);
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (priceOnRequest) {
      navigateToDetails();
      return;
    }
    // Добавляем товар с правильной ценой для defaultSize
    const productToAdd = {
      ...product,
      price: displayPrice.toString(),
      sizes: product.defaultSize ? [product.defaultSize] : product.sizes
    };
    addToCart(productToAdd);
  };
  return (
    <div 
      className="group flex w-full flex-col cursor-pointer"
      onClick={navigateToDetails}
    >
      <div
        className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100"
        onMouseLeave={handleMouseLeave}
      >
        {product.images.map((src, idx) => {
          const shouldRender = preloadedImages.has(idx);
          const isActive = getActiveImageIndex() === idx;
          
          return (
            <div
              key={`${currentColorIndex}-${idx}`}
              className={`absolute inset-0 transition-opacity duration-300 ease-in-out ${
                isActive ? 'opacity-100 z-10' : 'opacity-0 z-0'
              }`}
            >
              {shouldRender && (
                <LazyImage
                  fill
                  src={src}
                  showPlaceholder={false}
                  priority={idx === 0}
                  alt={`${product.product_name[locale]} - ${idx + 1}`}
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                />
              )}
            </div>
          );
        })}

        <div className="absolute inset-0 flex z-20">
          {product.images.map((_, idx) => (
            <div
              key={`segment-${idx}`}
              onMouseEnter={() => handleMouseEnterArea(idx)}
              className="flex-1 cursor-pointer"
              style={{ width: `${100 / product.images.length}%` }}
            />
          ))}
        </div>

        {product.images.length > 1 && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex space-x-1 z-20">
            {product.images.map((_, idx) => (
              <div
                key={`indicator-${idx}`}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                  getActiveImageIndex() === idx
                    ? 'bg-white shadow-lg'
                    : 'bg-white/50'
                }`}
              />
            ))}
          </div>
        )}

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-30">
          <button
            onClick={handleAddToCart}
            className="cursor-pointer hover:shadow-lg transition bg-white text-gray-900 px-4 py-2 rounded-lg shadow-md"
          >
            {priceOnRequest
  ? getRequestPriceCta(locale)
  : locale === 'en'
    ? 'Add to Cart'
    : locale === 'ru'
      ? 'В корзину'
      : 'Sepete Ekle'}
          </button>
          <AdminStockButton productCode={product.product_code} />
        </div>
      </div>

      <div className="mt-3 flex items-start justify-between px-1">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 truncate">
            {product.product_name[locale]}
          </h3>
          <p className="text-center text-sm text-gray-700 mt-1">
            {priceOnRequest ? getPriceOnRequestLabel(locale) : formatPrice(displayPrice, locale, eurToRubRate)}
          </p>
        </div>
        
        <button 
          className="ml-2 p-1 rounded-full hover:bg-gray-100 transition-colors duration-200 group/heart"
          aria-label="Add to wishlist"
          onClick={(e) => e.stopPropagation()}
        >
          <Heart className="h-4 w-4 text-gray-400 group-hover/heart:text-red-500 transition-colors duration-200" />
        </button>
      </div>
    </div>
  );
};

export default ProductCard;

