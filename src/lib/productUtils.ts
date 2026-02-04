import { RugProduct } from "@/types/product";

function parseSizeLabel(size: string): { w: number; h: number } | null {
  const cleaned = (size || "").replace(/cm/gi, "").trim();
  const m = cleaned.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

function sameSize(a?: string, b?: string): boolean {
  const aa = (a ?? "").trim().toLowerCase();
  const bb = (b ?? "").trim().toLowerCase();
  if (aa && bb && aa === bb) return true;

  const pa = parseSizeLabel(aa);
  const pb = parseSizeLabel(bb);
  if (!pa || !pb) return false;
  return pa.w === pb.w && pa.h === pb.h;
}

function resolvePreferredSize(rug: RugProduct, selectedSize?: string | null): string | null {
  const preferred = (selectedSize ?? "").trim();
  if (preferred) return preferred;
  if (rug.defaultSize?.trim()) return rug.defaultSize.trim();
  const firstSize = rug.sizes?.find((size) => size && size.trim().length > 0);
  return firstSize?.trim() ?? null;
}

function getBmhomeVariant(rug: RugProduct, selectedSize?: string | null) {
  const variants = rug.sourceMeta?.bmhome?.variants ?? [];
  if (!variants.length) return null;

  const preferredSize = resolvePreferredSize(rug, selectedSize);
  if (preferredSize) {
    const match = variants.find((variant) => sameSize(variant.sizeLabel ?? "", preferredSize));
    if (match) return match;
  }

  const activeVariant = variants.find((variant) => variant.isActive !== false);
  return activeVariant ?? variants[0] ?? null;
}

export function getBmhomeStockCode(rug: RugProduct, selectedSize?: string | null): string {
  const variant = getBmhomeVariant(rug, selectedSize);
  return variant?.sku ?? variant?.barcode ?? "";
}

export function isPriceOnRequestProduct(rug?: RugProduct | null): boolean {
  if (!rug) return false;
  const raw = typeof rug.price === "string" ? rug.price.trim() : String(rug.price ?? "");
  if (raw) {
    const numeric = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(numeric) && numeric <= 0) return true;
  }
  return rug.sourceMeta?.bmhome?.priceOnRequest === true;
}

export function getPriceOnRequestLabel(locale?: string): string {
  return locale === "en" ? "Price on request" : "Цена по запросу";
}

export function getRequestPriceCta(locale?: string): string {
  return locale === "en" ? "Request price" : "Запросить цену";
}

export function getDisplaySku(rug: RugProduct, selectedSize?: string | null): string {
  const bm = getBmhomeStockCode(rug, selectedSize);
  if (bm) return bm;
  return rug.product_code;
}

export function getBmhomeVariantPriceEur(rug: RugProduct, selectedSize?: string | null): number | null {
  const variant = getBmhomeVariant(rug, selectedSize);
  const val = variant?.priceEur;
  if (typeof val === "number" && Number.isFinite(val) && val > 0) return val;
  return null;
}

export function hasBmhomeSpecialSize(rug: RugProduct): boolean {
  const variants = rug.sourceMeta?.bmhome?.variants ?? [];
  return variants.some((variant) => variant.isSpecialSize);
}
