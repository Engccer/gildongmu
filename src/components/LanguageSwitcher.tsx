"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { withQuery } from "@/lib/locale-href";

/**
 * 언어 전환기 — 현재 경로와 ?q= 쿼리를 보존한 채 ko/en을 전환한다.
 * next-intl 미들웨어가 로케일 프리픽스 네비게이션 시 NEXT_LOCALE 쿠키를
 * 설정하므로, 한 번 고른 언어는 재방문 시 유지된다.
 * disabled 대신 aria-current로 현재 언어를 표시(포커스 보존).
 */
const LABEL_KEY: Record<string, "korean" | "english"> = {
  ko: "korean",
  en: "english",
};

export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const active = useLocale();
  const pathname = usePathname();
  // 클라이언트에서만 search 접근 — SSR 시 빈 문자열
  const search = typeof window !== "undefined" ? window.location.search : "";
  const href = withQuery(pathname, search);

  return (
    <nav aria-label={t("languageLabel")}>
      <ul className="flex gap-1">
        {routing.locales.map((loc) => {
          const isActive = loc === active;
          return (
            <li key={loc}>
              <Link
                href={href}
                locale={loc}
                aria-current={isActive ? "true" : undefined}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium aria-[current]:bg-accent aria-[current]:text-accent-foreground"
              >
                {t(LABEL_KEY[loc])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
