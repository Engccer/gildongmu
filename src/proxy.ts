import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { hasSupportedLanguage } from "./i18n/accept-language";

// Next.js 16: middleware.ts 대신 proxy.ts (워크스페이스 공통 컨벤션)
const intlMiddleware = createMiddleware(routing);

// 미지원 언어(zh·de 등) 브라우저는 defaultLocale(ko) 대신 en으로 폴백.
// Accept-Language에 지원 로케일이 하나도 없을 때만 헤더를 en으로 치환해
// next-intl에 협상시키므로 쿠키 우선순위·기존 협상 경로는 그대로다.
export default function proxy(request: NextRequest) {
  if (
    !hasSupportedLanguage(
      request.headers.get("accept-language"),
      routing.locales,
    )
  ) {
    const headers = new Headers(request.headers);
    headers.set("accept-language", "en");
    // 원본 Request를 input으로 넘겨 method·body를 계승하고 헤더만 교체
    return intlMiddleware(new NextRequest(request, { headers }));
  }
  return intlMiddleware(request);
}

export const config = {
  // API 라우트, Next 내부 경로, 정적 파일은 로케일 라우팅에서 제외
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
