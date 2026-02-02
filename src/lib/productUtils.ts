import { RugProduct } from "@/types/product";

export function isPriceOnRequestProduct(product?: RugProduct | null): boolean {
  if (!product) return false;
  if (product.sourceMeta?.bmhome?.priceOnRequest) return true;
  const raw = typeof product.price === "string" ? product.price.trim() : String(product.price ?? "");
  if (!raw) return false;
  const numeric = Number(raw.replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric <= 0;
}

export function getBmhomeSkuFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.split(/[?#]/)[0];
  const parts = clean.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  const sku = last.split("-")[0];
  return sku || null;
}

export function getDisplaySku(product?: RugProduct | null): string {
  if (!product) return "";
  const fromUrl = getBmhomeSkuFromUrl(product.sourceMeta?.bmhome?.productUrl);
  return fromUrl || product.product_code || "";
}

export function getPriceOnRequestLabel(locale?: string): string {
  return locale === "ru" ? "Цена по запросу" : "Price on request";
}

export function getRequestPriceCta(locale?: string): string {
  return locale === "ru" ? "Уточнить цену" : "Request price";
}
