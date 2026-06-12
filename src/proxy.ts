import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16: middleware.ts 대신 proxy.ts (워크스페이스 공통 컨벤션)
export default createMiddleware(routing);

export const config = {
  // API 라우트, Next 내부 경로, 정적 파일은 로케일 라우팅에서 제외
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
