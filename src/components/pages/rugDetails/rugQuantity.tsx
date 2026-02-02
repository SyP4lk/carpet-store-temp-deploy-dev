"use client";

import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, Minus, ShoppingCart, MessageSquare } from "lucide-react";
import { RugProduct } from "@/types/product";
import { useCartStore } from "@/hooks/useCartStore";
import { useSearchParams, useParams } from "next/navigation";
import { calculateRugPrice } from "@/lib/calculatePrice";
import { useDictionary } from "@/hooks/useDictionary";
import { useCurrency } from "@/context/CurrencyContext";
import { Locale } from "@/localization/config";
import { getDisplaySku, getPriceOnRequestLabel, getRequestPriceCta, isPriceOnRequestProduct } from "@/lib/productUtils";

type Props = {
  rug: RugProduct;
};

const RugQuantityAddToCart: React.FC<Props> = ({ rug }) => {
  const { addToCart } = useCartStore();
  const searchParams = useSearchParams();
  const params = useParams();
  const locale = params.locale as Locale;
  const { dictionary } = useDictionary();
  const { eurToRubRate } = useCurrency();

  // Use defaultSize if available, otherwise fallback to first size
  const getInitialSize = () => {
    const filteredSizes = rug.sizes?.filter(s => s && s.trim().length > 0) || [];
    return rug.defaultSize && filteredSizes.includes(rug.defaultSize)
      ? rug.defaultSize
      : filteredSizes[0] || "";
  };

  const [selectedSize, setSelectedSize] = useState(getInitialSize());
  const [quantity, setQuantity] = useState(1);

  // Order form state
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);


  useEffect(() => {
    const sizeParam = searchParams.get("size");
    const widthParam = searchParams.get("width");
    const heightParam = searchParams.get("height");

    if (sizeParam) {
      setSelectedSize(sizeParam);
    } else if (widthParam && heightParam) {
      setSelectedSize(`${widthParam}x${heightParam} cm`);
    } else {
      // Use initial size (which respects defaultSize)
      setSelectedSize(getInitialSize());
    }
  }, [searchParams, rug.sizes, rug.defaultSize]);


  const priceOnRequest = isPriceOnRequestProduct(rug);
  const basePrice = typeof rug.price === 'string' ? parseFloat(rug.price.replace(/,/g, '')) : (rug.price ?? 0);

  const priceEur = useMemo(() => {
    const sizes = rug.sizes ?? [];
    return calculateRugPrice(basePrice, sizes, selectedSize);
  }, [rug.sizes, selectedSize, basePrice]);

  // Конвертируем в рубли для ru локали с наценкой 2%
  const displayPrice = useMemo(() => {
    if (locale === 'ru') {
      return Math.round(priceEur * eurToRubRate * 1.02);
    }
    // EN: евро + 2% наценка
    return Math.round(priceEur * 1.02);
  }, [priceEur, locale, eurToRubRate]);

  const orderPriceEur = priceOnRequest ? 0 : priceEur;
  const orderDisplayPrice = priceOnRequest ? 0 : displayPrice;

  const handleDecrease = () => {
    if (quantity > 1) setQuantity(quantity - 1);
  };

  const handleIncrease = () => {
    setQuantity(quantity + 1);
  };

  const handleAddToCart = () => {
    if (priceOnRequest) return;
    // Добавляем товар с обновленной ценой и размером
    const productToAdd = {
      ...rug,
      sizes: [selectedSize],
      price: orderPriceEur.toString()
    };

    // addToCart принимает только product, quantity управляется внутри
    for (let i = 0; i < quantity; i++) {
      addToCart(productToAdd);
    }
  };

  const handleOrder = async () => {
    if (!name || !phone) {
      setMessage(dictionary?.cart.order.fillAllFields || "⚠️ Заполните все поля");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const singleItem = {
        item: {
          ...rug,
          sizes: [selectedSize],
          price: orderPriceEur
        },
        quantity: quantity,
        selectedSize: selectedSize,
        totalPrice: orderDisplayPrice * quantity
      };

      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-locale": locale,
        },
        body: JSON.stringify({
          name,
          phone,
          cart: [singleItem],
          subtotal: orderDisplayPrice * quantity,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage(dictionary?.cart.order.success || "✅ Заявка отправлена");
        // Показываем сообщение 1.5 секунды, потом закрываем модалку
        setTimeout(() => {
          setShowModal(false);
          // Сбрасываем форму после закрытия модалки
          setTimeout(() => {
            setMessage("");
            setName("");
            setPhone("");
          }, 100);
        }, 1500);
      } else {
        setMessage(dictionary?.cart.order.error || "❌ Ошибка");
      }
    } catch (error) {
      setMessage(dictionary?.cart.order.error || "❌ Ошибка");
    } finally {
      setLoading(false);
    }
  };




  return (
    <>
      {!priceOnRequest && (
        <div className="flex items-center space-x-4 mt-4">
        <div className="flex items-center border overflow-hidden">
          <button onClick={handleDecrease} className="px-3 py-2 cursor-pointer">
            <Minus size={14} />
          </button>
          <span className="px-4 py-2">{quantity}</span>
          <button onClick={handleIncrease} className="px-3 py-2 cursor-pointer">
            <Plus size={14} />
          </button>
        </div>

        <button
          onClick={handleAddToCart}
          className="flex items-center px-4 py-2 border cursor-pointer hover:bg-black hover:text-white transition"
        >
          <ShoppingCart size={16} className="mr-2" />
          {dictionary?.cart.addToBasket} —{" "}
          {displayPrice ? (displayPrice * quantity).toLocaleString("ru-RU") : "-"}{" "}
          {locale === 'ru' ? '₽' : '€'}
        </button>
      </div>

      )}

      {priceOnRequest && (
        <p className="mt-4 text-sm text-gray-600">{getPriceOnRequestLabel(locale)}</p>
      )}

      {/* Кнопка "Оставить заявку" */}
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center justify-center w-full px-4 py-3 mt-4 bg-green-600 text-white rounded hover:bg-green-700 transition"
      >
        <MessageSquare size={18} className="mr-2" />
        {priceOnRequest ? getRequestPriceCta(locale) : locale === 'ru' ? 'Оставить заявку' : 'Leave a Request'}
      </button>

      {/* Order Modal */}
      {mounted && showModal && createPortal(
        <div
          key="order-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 bg-opacity-50 transition-opacity"
          onClick={() => !loading && setShowModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg p-6 w-96 transform transition-all scale-95"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium mb-4">
              {dictionary?.cart.order.enterDetails || 'Введите данные'}
            </h2>
            <input
              type="text"
              placeholder={dictionary?.cart.order.name || 'Имя'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border p-2 mb-3 rounded"
              disabled={loading}
            />
            <input
              type="tel"
              placeholder={dictionary?.cart.order.phone || 'Телефон'}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border p-2 mb-3 rounded"
              disabled={loading}
            />

            {/* Показываем информацию о товаре */}
            <div className="mb-3 p-3 bg-gray-50 rounded text-sm">
              <p><strong>{dictionary?.cart.order.stock || 'Артикул'}:</strong> {getDisplaySku(rug)}</p>
              <p><strong>{locale === 'ru' ? 'Размер' : 'Size'}:</strong> {selectedSize}</p>
              <p><strong>{dictionary?.cart.quantity || 'Количество'}:</strong> {quantity}</p>
            </div>

            {message && <p className="text-sm text-red-500 mb-2">{message}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border rounded"
                disabled={loading}
              >
                {dictionary?.cart.order.cancel || 'Отмена'}
              </button>
              <button
                onClick={handleOrder}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded flex items-center justify-center gap-2 disabled:opacity-50 min-w-[120px]"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {dictionary?.cart.order.sending || 'Отправка...'}
                  </>
                ) : (
                  dictionary?.cart.order.confirm || 'Подтвердить'
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default RugQuantityAddToCart;

