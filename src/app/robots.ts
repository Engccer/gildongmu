import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

// 크롤러(검색·AI 답변 엔진 공통) 허용, API 라우트만 제외.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
