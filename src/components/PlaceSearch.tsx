"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Place, PlaceSearchResult, RouteMode } from "@/lib/types";
import {
  buildPlaceDeeplink,
  buildRouteDeeplink,
  buildWebFallbackUrl,
} from "@/lib/deeplink";
import {
  buildKakaoWebMapUrl,
  buildKakaoWebRouteUrl,
} from "@/lib/deeplink-kakao";
import { groupByCategory } from "@/lib/category";
import { CarRouteBriefing } from "./CarRouteBriefing";

const APPNAME =
  process.env.NEXT_PUBLIC_APP_IDENTIFIER ?? "space.dodoplanet.gildongmu";

const ROUTE_MODES: RouteMode[] = ["public", "walk", "car"];

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; result: PlaceSearchResult };

/**
 * 장소 검색 — 접근성 1급 시민 컴포넌트.
 *
 * 설계 원칙 (docs/SPEC.md):
 * - 정보의 정본은 리스트/텍스트. 지도는 나중에 얹는 시각 보조 레이어.
 * - 결과 수·오류는 aria-live 영역으로 스크린 리더에 즉시 통지.
 * - 검색 완료 시 결과 헤딩으로 포커스 이동 → 키보드/스크린 리더 사용자가
 *   결과 위치를 찾아 헤매지 않게 한다.
 */
export function PlaceSearch({
  isMockMode,
  canBriefCarRoute = false,
}: {
  isMockMode: boolean;
  /** 카카오 키가 있어 자동차 경로 텍스트 브리핑을 제공할 수 있는지 */
  canBriefCarRoute?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "loading") return;
    const q = query.trim();
    if (!q) return;

    setStatus({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/places?query=${encodeURIComponent(q)}&lang=${locale}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as PlaceSearchResult;
      setStatus({ kind: "done", result });
      // 렌더 후 결과 헤딩으로 포커스 이동
      requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  const liveMessage =
    status.kind === "loading"
      ? t("search.searching")
      : status.kind === "error"
        ? t("search.error")
        : status.kind === "done"
          ? t("search.resultsAnnouncement", {
              count: status.result.places.length,
            })
          : "";

  return (
    <section aria-label={t("search.label")}>
      {isMockMode && (
        <p
          role="note"
          className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {t("search.mockNotice")}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="place-query" className="sr-only">
          {t("search.label")}
        </label>
        <input
          id="place-query"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          autoComplete="off"
          className="min-h-12 flex-1 rounded-md border border-gray-400 px-4 text-lg"
        />
        {/* disabled 대신 aria-disabled — 검색 중에도 포커스를 잃지 않게 한다 */}
        <button
          type="submit"
          aria-disabled={status.kind === "loading"}
          aria-busy={status.kind === "loading"}
          className="min-h-12 rounded-md bg-blue-700 px-6 text-lg font-semibold text-white aria-disabled:opacity-50"
        >
          {t("search.button")}
        </button>
      </form>

      {/* 스크린 리더 상태 통지 — 시각적으로도 함께 표시 */}
      <p aria-live="polite" role="status" className="mt-3 min-h-6 text-sm">
        {liveMessage}
      </p>

      {status.kind === "done" && (
        <div className="mt-4">
          <h2
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            {t("search.resultsAnnouncement", {
              count: status.result.places.length,
            })}
          </h2>
          {status.result.places.length === 0 ? (
            <p className="mt-2">{t("search.noResults")}</p>
          ) : (
            // 카테고리 버킷별 섹션으로 표시 — 카카오·TourAPI를 출처가 아닌
            // 의미(관광·쇼핑·교통 등)로 재편해 검색 의도와 노이즈를 분리한다.
            <div className="mt-3 flex flex-col gap-6">
              {groupByCategory(status.result.places).map((group) => {
                const heading = t("category.groupHeading", {
                  label: t(`category.${group.bucket}`),
                  count: group.places.length,
                });
                return (
                  // 카테고리 그룹은 랜드마크가 아니라 문서 구조 — section에
                  // aria-label을 주면 region이 되어 h3와 중복 발표되므로,
                  // 헤딩(h3)만으로 구조를 담당하게 한다(aria-label 제거).
                  <section key={group.bucket}>
                    <h3 className="text-lg font-semibold">{heading}</h3>
                    <ul className="mt-2 flex flex-col gap-4">
                      {group.places.map((place) => (
                        <PlaceCard
                          key={place.id}
                          place={place}
                          canBriefCarRoute={canBriefCarRoute}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlaceCard({
  place,
  canBriefCarRoute,
}: {
  place: Place;
  canBriefCarRoute: boolean;
}) {
  const t = useTranslations();
  const dest = { lat: place.lat, lng: place.lng, name: place.name };

  return (
    <li className="rounded-lg border border-gray-300 p-4">
      {/* h4 — 헤딩 계층: h2(결과 수) > h3(카테고리 버킷) > h4(장소명) */}
      <h4 className="text-lg font-bold">{place.name}</h4>
      <dl className="mt-1 text-sm leading-relaxed">
        <div>
          <dt className="inline font-medium">{t("place.category")}: </dt>
          <dd className="inline">{place.category}</dd>
        </div>
        <div>
          <dt className="inline font-medium">{t("place.roadAddress")}: </dt>
          {/* 영문 주소가 있으면(en 검색) 영문을 메인으로, 한글은 보조로.
              한글 줄에 lang="ko"를 주어 영문 UI 스크린 리더가 한국어로 읽게 한다. */}
          <dd className="inline">
            {place.englishAddress ?? (place.roadAddress || place.address)}
          </dd>
          {place.englishAddress && (place.roadAddress || place.address) && (
            <dd className="mt-0.5 text-xs opacity-70" lang="ko">
              {place.roadAddress || place.address}
            </dd>
          )}
        </div>
        {place.phone && (
          <div>
            <dt className="inline font-medium">{t("place.phone")}: </dt>
            <dd className="inline">
              <a
                href={`tel:${place.phone}`}
                aria-label={t("place.callAction", { name: place.name })}
                className="underline"
              >
                {place.phone}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <nav aria-label={t("route.heading", { name: place.name })}>
        {/* 네이버 지도 — 앱 딥링크 (nmap://) */}
        <div
          role="group"
          aria-label={t("route.naverGroup", { name: place.name })}
          className="mt-3"
        >
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
        <div
          role="group"
          aria-label={t("route.kakaoGroup", { name: place.name })}
          className="mt-3"
        >
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
      </nav>

      {canBriefCarRoute && <CarRouteBriefing dest={dest} />}
    </li>
  );
}
