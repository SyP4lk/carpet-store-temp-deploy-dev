export function rewriteTicimaxImageUrl(raw: string): string {
  const url = (raw ?? "").trim();
  if (!url) return url;

  if (url.startsWith("/ticimax/")) return url;
  if (!url.includes("ticimax.cloud")) return url;

  try {
    const u = new URL(url);
    return `/ticimax${u.pathname}${u.search ?? ""}`;
  } catch {
    const noProto = url.replace(/^https?:\/\//, "");
    const slash = noProto.indexOf("/");
    if (slash === -1) return url;
    return `/ticimax/${noProto.slice(slash + 1)}`;
  }
}

export function shouldUnoptimizeImage(src: unknown): boolean {
  return (
    typeof src === "string" &&
    (src.includes("ticimax.cloud") || src.startsWith("/ticimax/"))
  );
}
