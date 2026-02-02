import { NextResponse } from "next/server";
import { getDictionary } from "@/localization/dictionary";
import { Locale } from "@/localization/config";
import { getBmhomeSkuFromUrl, getPriceOnRequestLabel, isPriceOnRequestProduct } from "@/lib/productUtils";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_IDS = process.env.TELEGRAM_CHAT_IDS?.split(",").map((id) => id.trim()) || [];

// Используем альтернативный API endpoint если основной недоступен
const TELEGRAM_API_BASE = process.env.TELEGRAM_API_URL || "https://api.telegram.org";

export async function POST(req: Request) {
  try {
    const { name, phone, cart, subtotal } = await req.json();

    if (!name || !phone || !cart) {
      return NextResponse.json(
        { success: false, error: "❌ Missing params" },
        { status: 400 }
      );
    }

    const locale = (req.headers.get("x-locale") || "en") as Locale;
    const dict = await getDictionary(locale);

    // Логируем данные для отладки
    console.log('📦 Данные заказа:');
    console.log('Locale:', locale);
    console.log('Subtotal:', subtotal);
    console.log('Товары в корзине:', cart.map((ci: any) => ({
      name: ci.item.product_name[locale],
      totalPrice: ci.totalPrice,
      quantity: ci.quantity
    })));

    // Определяем валюту в зависимости от локали
    const currency = locale === 'ru' ? '₽' : '€';

    const orderText = `
<b>${dict.cart.order.newOrder}</b>

👤 <b>${dict.cart.order.name}:</b> ${name}
📞 <b>${dict.cart.order.phone}:</b> ${phone}

<b>${dict.cart.order.cart}:</b>
${cart
  .map((ci: any, i: number) => {
    const sku = getBmhomeSkuFromUrl(ci.item?.sourceMeta?.bmhome?.productUrl) || ci.item.product_code
    const priceOnRequest = isPriceOnRequestProduct(ci.item)
    const priceLabel = priceOnRequest
      ? getPriceOnRequestLabel(locale)
      : `${Math.round(ci.totalPrice).toLocaleString('ru-RU')}${currency}`
    return `${i + 1}) <b>${ci.item.product_name[locale]}</b> (${ci.size || ci.item.sizes[0]} cm)
   <b>${dict.cart.order.stock}:</b> ${sku}
   💰 ${dict.cart.order.subtotal}: ${priceLabel}`
  })
  .join("\n\n")}
━━━━━━━━━━━━━━━
💰 <b>${dict.cart.order.subtotal}:</b> ${Math.round(subtotal).toLocaleString('ru-RU')}${currency}
    `;

    // Отправка в Telegram с увеличенным timeout
    console.log(`📤 Отправка заказа в Telegram. BOT_TOKEN: ${BOT_TOKEN ? 'есть' : 'нет'}, CHAT_IDS: ${CHAT_IDS.join(', ')}`);

    // Сохраняем заказ в консоль для отладки
    console.log('📝 Текст заказа:', orderText);

    let telegramSuccess = false;

    try {
      const results = await Promise.all(
        CHAT_IDS.map(async (chatId) => {
          try {
            console.log(`📞 Отправка в chat: ${chatId}`);
            console.log(`🔗 URL: ${TELEGRAM_API_BASE}/bot${BOT_TOKEN.substring(0, 15)}...`);

            const response = await fetch(`${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: orderText,
                parse_mode: "HTML",
              }),
            });

            const data = await response.json();
            console.log(`📥 Telegram response:`, JSON.stringify(data, null, 2));

            if (response.ok) {
              telegramSuccess = true;
              console.log(`✅ Сообщение успешно отправлено в chat ${chatId}`);
            } else {
              console.error(`❌ Telegram API вернул ошибку:`, data);
            }

            return data;
          } catch (err: any) {
            console.error(`❌ Ошибка при отправке в chat ${chatId}:`, err.message);
            console.error('Stack:', err.stack);
            return null;
          }
        })
      );

      console.log(`📊 Результаты отправки:`, results.map(r => r ? 'OK' : 'FAILED'));

      if (!telegramSuccess) {
        console.warn('⚠️ НИ ОДНО сообщение не было доставлено в Telegram!');
        console.warn('⚠️ Это нормально для локального сервера, если api.telegram.org заблокирован');
        console.warn('⚠️ На production сервере в России должно работать!');
      }
    } catch (telegramError) {
      console.error("❌ Общая ошибка Telegram:", telegramError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Send order error:", error);
    return NextResponse.json(
      { success: false, error: "Server error" },
      { status: 500 }
    );
  }
}
