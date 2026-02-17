"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Trash,
  ShoppingCart,
} from "lucide-react";
import Image from "next/image";
import { useDictionary } from "@/hooks/useDictionary";
import { useCartStore } from "@/hooks/useCartStore";
import { useLocale } from "@/hooks/useLocale";
import { useCurrency } from "@/context/CurrencyContext";
import Link from "next/link";
import { getPriceOnRequestLabel, isPriceOnRequestProduct, isSpecialSizeLabel, localizeSizeLabel } from "@/lib/productUtils";
import { shouldUnoptimizeImage } from "@/lib/ticimaxImages";

const CartPage = () => {
  const [locale] = useLocale();
  const { dictionary } = useDictionary();
  const { eurToRubRate } = useCurrency();

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

  const {
    cart,
    removeFromCart,
    clearCart,
  } = useCartStore();

  // Конвертация цены в зависимости от локали с наценкой 2%
  const convertPrice = useCallback((priceEur: number) => {
    if (locale === 'ru') {
      return Math.round(priceEur * eurToRubRate * 1.02);
    }
    // EN: евро + 2% наценка
    return Math.round(priceEur * 1.02);
  }, [eurToRubRate, locale]);

  // hisob-kitoblar (в EUR)
  const subtotalEur = cart.reduce((sum, ci) => sum + ci.totalPrice, 0);
  const subtotal = useMemo(() => convertPrice(subtotalEur), [convertPrice, subtotalEur]);

  const handleOrder = async () => {
    if (!name || !phone) {
      setMessage(dictionary?.cart.order.fillAllFields || "⚠️");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      // Конвертируем цены товаров перед отправкой
      const cartWithConvertedPrices = cart.map(ci => ({
        ...ci,
        totalPrice: convertPrice(ci.totalPrice)
      }));

      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-locale": locale,
        },
        body: JSON.stringify({
          name,
          phone,
          cart: cartWithConvertedPrices,
          subtotal,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage(dictionary?.cart.order.success || "✅");
        setLoading(false);

        // Откладываем все изменения состояния чтобы избежать конфликтов DOM
        setTimeout(() => {
          clearCart(); // Очищаем корзину после показа сообщения
          setShowModal(false);
          setName("");
          setPhone("");
          setMessage("");
        }, 2000);
      } else {
        setMessage(dictionary?.cart.order.error || "❌");
        setLoading(false);
      }
    } catch {
      setMessage("❌ Server error");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="w-full flex justify-between items-center space-x-4">
            <Link href={`/${locale}/`}>
              <Image  
              src="/logo-dark.png" 
              width={100} 
              height={50} 
              alt="logo" 
             
               />
            </Link>
            <div className="size-12 bg-gray-300 rounded-full cursor-pointer"></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-medium">
                {dictionary?.cart.basket} ({cart.length})
              </h1>
              <button onClick={clearCart} className="text-red-500 text-sm cursor-pointer">
                {dictionary?.cart.clearCart}
              </button>
            </div>

            {/* Free Shipping Banner */}
            <div className="bg-green-100 border border-green-300 rounded-lg p-4 mb-6 flex items-center">
              <ShoppingCart className="text-green-600 mr-3" size={20} />
              <span className="text-green-700 text-sm">
                {dictionary?.cart.freeShipping}
              </span>
            </div>

            {/* Cart Items */}
            <div className="space-y-6">
              {cart.map((ci) => (
                <div
                  key={ci.item.id}
                  className="bg-white rounded-lg p-6 shadow-sm flex items-start space-x-4"
                >
                  <Image
                    width={80}
                    height={80}
                    src={ci.item.images[0]}
                    alt={String(ci.item.id)}
                    loading="lazy"
                    className="w-20 h-20 object-cover rounded"
                    unoptimized={shouldUnoptimizeImage(ci.item.images?.[0])}
                  />
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">
                      {ci.item.product_name[locale]}
                    </h3>
                    <p className="text-gray-500 text-sm">
                      {(() => {
                        const rawSize = ci.item.sizes?.[0] ?? "";
                        const localized = localizeSizeLabel(rawSize, locale);
                        if (!rawSize) return "-";
                        if (isSpecialSizeLabel(rawSize) || /cm/i.test(rawSize)) return localized;
                        return `${localized} cm`;
                      })()}
                    </p>
                    <p className="text-gray-500 text-sm mb-2">
                      {dictionary?.cart.yourCustomizations} ({ci.quantity}{" "}
                      {dictionary?.cart.quantity})
                    </p>
                    <button
                      onClick={() => removeFromCart(ci.item.id)}
                      className="text-red-500 hover:text-red-700 p-2 border rounded-full"
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                  <div className="text-green-600 font-bold">
                    {isPriceOnRequestProduct(ci.item)
                      ? getPriceOnRequestLabel(locale)
                      : `${convertPrice(ci.totalPrice).toLocaleString("ru-RU")} ${locale === 'ru' ? '₽' : '€'}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg p-6 shadow-sm sticky top-8">
              <h2 className="font-medium text-lg mb-6">
                {dictionary?.cart.orderSummary}
              </h2>
              <div className="space-y-4 mb-6">
                <div className="flex justify-between">
                  <span>{dictionary?.cart.basketAmount}</span>
                  <span>{subtotal.toLocaleString("ru-RU")} {locale === 'ru' ? '₽' : '€'}</span>
                </div>
                <div className="flex justify-between">
                  <span>{dictionary?.cart.shippingCost}</span>
                  <span className="text-green-600">{dictionary?.cart.free}</span>
                </div>

                <hr />
                <div className="flex justify-between font-bold text-lg">
                  <span>{dictionary?.cart.totalAmount}</span>
                  <span>{subtotal.toLocaleString("ru-RU")} {locale === 'ru' ? '₽' : '€'}</span>
                </div>
              </div>

              <button
                onClick={() => cart.length > 0 && setShowModal(true)}
                disabled={cart.length === 0}
                className={`w-full py-3 rounded-lg font-medium mb-4 ${
                  cart.length === 0
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-green-600 text-white hover:bg-green-700"
                }`}
              >
                {dictionary?.cart.completeShopping}
              </button>
            </div>
          </div>
        </div>

        {/* Order Modal - используем Portal для правильного рендеринга */}
        {mounted && showModal && createPortal(
          <div
            key="order-modal"
            className="fixed inset-0 flex items-center justify-center bg-black/30 bg-opacity-50 transition-opacity z-50"
            onClick={() => !loading && setShowModal(false)}
          >
            <div
              className="bg-white rounded-xl shadow-lg p-6 w-96 transform transition-all scale-95"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-medium mb-4">
                {dictionary?.cart.order.enterDetails}
              </h2>
              <input
                type="text"
                placeholder={dictionary?.cart.order.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border p-2 mb-3 rounded"
                disabled={loading}
              />
              <input
                type="tel"
                placeholder={dictionary?.cart.order.phone}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border p-2 mb-3 rounded"
                disabled={loading}
              />
              {message && <p className="text-sm text-red-500 mb-2">{message}</p>}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border rounded"
                  disabled={loading}
                >
                  {dictionary?.cart.order.cancel}
                </button>
                <button
                  onClick={handleOrder}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded flex items-center gap-2 disabled:opacity-50"
                >
                  {loading && (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {loading
                    ? dictionary?.cart.order.sending
                    : dictionary?.cart.order.confirm}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
};

export default CartPage;


                    {/* Last Viewed */}
                    {/* <div className="mt-12">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-medium">{dictionary?.cart.lastViewed}</h2>
                            <div className="flex space-x-2">
                                <button className="p-2 border border-gray-300 rounded hover:bg-gray-50">
                                    <ArrowLeft size={16} />
                                </button>
                                <button className="p-2 border border-gray-300 rounded hover:bg-gray-50">
                                    <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                            {rugs.map((rug) => (
                                <div key={rug.id} className="group">
                                    <div className="aspect-square mb-3 relative overflow-hidden rounded-lg">
                                        <Image
                                            width={600}
                                            height={400}
                                            src={rug.images[0]}
                                            alt={rug.product_name[locale]}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                        />
                                    </div>
                                    <h3 className="text-xs font-medium text-gray-900 mb-1 line-clamp-2">
                                        {rug.product_name[locale].toUpperCase()}
                                    </h3>
                                    <div className="text-sm font-bold mb-2">${parseFloat(rug.price).toFixed(2)}</div>
                                    <button
                                        onClick={() => toggleCart(rug.id)}
                                        className={`w-full py-2 px-3 text-xs rounded ${cart.includes(rug.id)
                                            ? 'bg-green-600 text-white'
                                            : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                                            }`}
                                    >
                                        {cart.includes(rug.id) ? dictionary?.cart.inBasket : dictionary?.cart.addToBasket}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div> */}
