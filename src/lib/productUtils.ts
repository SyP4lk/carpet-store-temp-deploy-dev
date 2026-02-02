import { RugProduct } from "@/types/product";

export function isPriceOnRequestProduct(product?: RugProduct | null): boolean {
  if (!product) return false;
  if (product.sourceMeta?.bmhome?.priceOnRequest) return true;
  const raw = typeof product.price === "string" ? product.price.trim() : String(product.price ?? "");
  if (!raw) return false;
  const numeric = Number(raw.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric <= 0;
}

function normalizeSize(input?: string | null): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/cm/g, "")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*x\s*/g, " x ")
    .trim();
}

/**
 * BMHOME "Stock Code" / variant SKU.
 * Хранится в sourceMeta.bmhome.variants[].sku (из XML <StokKodu>).
 */
export function getBmhomeStockCode(product?: RugProduct | null, preferredSize?: string | null): string | null {
  const variants = product?.sourceMeta?.bmhome?.variants;
  if (!product || !Array.isArray(variants) || variants.length === 0) return null;

  const wanted = normalizeSize(preferredSize || product.defaultSize || product.sizes?.[0]);

  // 1) Пробуем найти вариант по выбранному размеру
  if (wanted) {
    const v = variants.find((x) => normalizeSize(x?.sizeLabel) === wanted);
    const code = v?.sku || v?.barcode;
    if (code) return String(code);
  }

  // 2) Фолбек - первый активный вариант
  const v0 = variants.find((x) => x?.isActive !== false) || variants[0];
  return v0?.sku ? String(v0.sku) : v0?.barcode ? String(v0.barcode) : null;
}

/**
 * Legacy SKU from BMHOME product URL, like .../amp000181-4692 -> amp000181
 */
export function getBmhomeSkuFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.split(/[?#]/)[0];
  const parts = clean.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  const sku = last.split("-")[0];
  return sku || null;
}

/**
 * Что показываем в UI как "Артикул" / "SKU".
 * Для BMHOME приоритет - Stock Code (StokKodu), он совпадает с партнером.
 */
export function getDisplaySku(product?: RugProduct | null, preferredSize?: string | null): string {
  if (!product) return "";

  const stockCode = getBmhomeStockCode(product, preferredSize);
  if (stockCode) return stockCode;

  const fromUrl = getBmhomeSkuFromUrl(product.sourceMeta?.bmhome?.productUrl);
  return fromUrl || product.product_code || "";
}

export function getPriceOnRequestLabel(locale?: string): string {
  return locale === "ru" ? "Цена по запросу" : "Price on request";
}

export function getRequestPriceCta(locale?: string): string {
  return locale === "ru" ? "Уточнить цену" : "Request price";
}
