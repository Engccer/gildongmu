import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { SITE_ORIGIN } from "@/lib/site";

// 로케일 × 정적 페이지 전개. 동적 뷰(?q=·?panel=)는 쿼리 상태라 sitemap 대상 아님.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/about", "/privacy"];
  return routing.locales.flatMap((locale) =>
    pages.map((page) => ({ url: `${SITE_ORIGIN}/${locale}${page}` }))
  );
}
