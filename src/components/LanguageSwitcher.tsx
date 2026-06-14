"use client";

import { useSyncExternalStore } from "react";
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

/**
 * location.search를 외부 스토어로 구독한다. 서버 스냅샷은 빈 문자열이라
 * SSG 프리렌더 href와 첫 클라이언트 페인트가 일치하고(hydration mismatch 방지),
 * 마운트 후 클라이언트 스냅샷이 실제 ?q= 쿼리를 반영한다.
 */
function subscribeSearch(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
function getSearchSnapshot() {
  return window.location.search;
}
function getServerSearchSnapshot() {
  return "";
}

export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const active = useLocale();
  const pathname = usePathname();
  const search = useSyncExternalStore(
    subscribeSearch,
    getSearchSnapshot,
    getServerSearchSnapshot,
  );
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
                aria-current={isActive ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium aria-[current]:bg-accent aria-[current]:text-accent-foreground"
              >
                {/* 각 옵션을 자국어로 표기 — 해당 언어 태그를 줘 SR이 올바른
                    음성 엔진으로 읽게 한다(영문 UI에서 "한국어"를 한국어로). */}
                <span lang={loc}>{t(LABEL_KEY[loc])}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
