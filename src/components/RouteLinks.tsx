"use client";

import { useTranslations } from "next-intl";
import type { Place, RouteMode } from "@/lib/types";
import {
  buildPlaceDeeplink,
  buildRouteDeeplink,
  buildWebFallbackUrl,
} from "@/lib/deeplink";
import {
  buildKakaoWebMapUrl,
  buildKakaoWebRouteUrl,
} from "@/lib/deeplink-kakao";

const APPNAME =
  process.env.NEXT_PUBLIC_APP_IDENTIFIER ?? "space.dodoplanet.gildongmu";

const ROUTE_MODES: RouteMode[] = ["public", "walk", "car"];

/**
 * 네이버·카카오 길찾기 딥링크 묶음.
 * 내비게이션은 네이티브 앱 위임 원칙을 따른다(딥링크/웹 폴백).
 */
export function RouteLinks({ place }: { place: Place }) {
  const t = useTranslations();
  const dest = { lat: place.lat, lng: place.lng, name: place.name };

  return (
    <div>
      {/* 네이버 지도 — 앱 딥링크 (nmap://) */}
      <div className="mt-3">
        <p aria-hidden="true" className="text-xs font-medium opacity-70">
          {t("route.naverLabel")}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {ROUTE_MODES.map((mode) => (
            <a
              key={mode}
              href={buildRouteDeeplink(mode, { dest }, APPNAME)}
              aria-label={t("route.naverModeAction", {
                mode: t(`route.${mode}`),
              })}
              title={t("route.deeplinkHint")}
              className="min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300"
            >
              {t(`route.${mode}`)}
            </a>
          ))}
          <a
            href={buildPlaceDeeplink(place, APPNAME)}
            title={t("route.deeplinkHint")}
            className="min-h-11 rounded-md border border-gray-500 px-4 py-2 text-sm"
          >
            {t("place.openInNaverMap")}
          </a>
          <a
            href={buildWebFallbackUrl(place.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 rounded-md border border-gray-500 px-4 py-2 text-sm"
          >
            map.naver.com
          </a>
        </div>
      </div>

      {/* 카카오맵 — 웹 URL (모바일은 앱으로, 데스크톱은 웹 지도로 자연 폴백) */}
      <div className="mt-3">
        <p aria-hidden="true" className="text-xs font-medium opacity-70">
          {t("route.kakaoLabel")}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {ROUTE_MODES.map((mode) => (
            <a
              key={mode}
              href={buildKakaoWebRouteUrl(mode, dest)}
              aria-label={t("route.kakaoModeAction", {
                mode: t(`route.${mode}`),
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 rounded-md border border-amber-600 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-300"
            >
              {t(`route.${mode}`)}
            </a>
          ))}
          <a
            href={buildKakaoWebMapUrl(dest)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 rounded-md border border-gray-500 px-4 py-2 text-sm"
          >
            {t("place.openInKakaoMap")}
          </a>
          {place.link && (
            <a
              href={place.link}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 rounded-md border border-gray-500 px-4 py-2 text-sm"
            >
              {t("place.detailPage")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
