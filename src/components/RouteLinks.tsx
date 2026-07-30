"use client";

import { useTranslations } from "next-intl";
import type { Place } from "@/lib/types";
import {
  buildPlaceDeeplink,
  buildWebFallbackUrl,
  isMobileUserAgent,
} from "@/lib/deeplink";
import { buildKakaoWebMapUrl } from "@/lib/deeplink-kakao";

const APPNAME =
  process.env.NEXT_PUBLIC_APP_IDENTIFIER ?? "space.dodoplanet.gildongmu";

/**
 * 외부 지도 앱 "열기" 버튼 묶음 — 프로바이더당 대표 1개(스펙 2026-07-30 §4).
 * 모드(도보·대중교통·자동차) 선택은 길찾기 뷰의 책임이라 여기서 전개하지 않는다.
 * 네이버는 환경별 폴백 내장: 모바일=nmap:// 시도 후 미설치 시 웹 지도 타이머 폴백
 * (앱이 열리면 pagehide/visibilitychange가 타이머를 취소), 데스크톱=웹 지도 직행.
 * 카카오는 웹 URL이 모바일 앱 전환을 자체 처리하므로 앵커 하나로 충분.
 */
export function RouteLinks({ place }: { place: Place }) {
  const t = useTranslations();

  function openNaver() {
    const webUrl = buildWebFallbackUrl(place.name);
    if (!isMobileUserAgent(navigator.userAgent)) {
      window.open(webUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const timer = window.setTimeout(() => {
      window.location.href = webUrl;
    }, 1500);
    const cancel = () => window.clearTimeout(timer);
    window.addEventListener("pagehide", cancel, { once: true });
    document.addEventListener("visibilitychange", cancel, { once: true });
    window.location.href = buildPlaceDeeplink(place, APPNAME);
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={openNaver}
        className="inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-sm font-medium"
      >
        {t("place.openInNaverMap")}
      </button>
      <a
        href={buildKakaoWebMapUrl({ lat: place.lat, lng: place.lng, name: place.name })}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-sm font-medium"
      >
        {t("place.openInKakaoMap")}
      </a>
      {place.link && (
        <a
          href={place.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-4 py-2 text-sm"
        >
          {t("place.detailPage")}
        </a>
      )}
    </div>
  );
}
