"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  getActiveNearbyPanel,
  getServerActiveNearbyPanel,
  subscribeNearbyPanel,
} from "@/lib/nearby-panel-store";
import { WhereAmI } from "./WhereAmI";
import { SubwayArrivalsNearby } from "./SubwayArrivalsNearby";
import { BusArrivals } from "./BusArrivals";
import { BikeStations } from "./BikeStations";
import { NightClinicsNearby } from "./NightClinicsNearby";
import { BarrierFreeNearby } from "./BarrierFreeNearby";
import { KidsPlacesNearby } from "./KidsPlacesNearby";
import { SurroundingsNearby } from "./SurroundingsNearby";
import { WalkInfraNearby } from "./WalkInfraNearby";
import { LocalConditions } from "./LocalConditions";

/**
 * "내 주변" 허브 — 홈에 평면 나열되던 9개 도메인 섹션의 새 거처(스펙 2026-07-30 §2).
 * 섹션 컴포넌트들은 무수정 이동: 아코디언·단일 점유(nearby-panel-store)·포커스 계약을
 * 그대로 보존하고, 허브 자체의 열림/닫힘만 PlaceSearch의 URL·History가 소유한다.
 *
 * Esc = 뒤로가기 동등(스펙 §2). 단 아코디언 패널이 점유 중이면 그 패널의 자체 Esc가
 * 우선이므로 허브 Esc는 비활성(스택된 전역 Esc 경합 규칙과 동형).
 */
export function NearbyHub({
  canShowWhereAmI,
  canShowSubway,
  canShowBus,
  canShowBike,
  canShowClinic,
  canShowBarrierFree,
  canShowKids,
  canShowSurroundings,
  canShowAir,
  onBack,
}: {
  canShowWhereAmI: boolean;
  canShowSubway: boolean;
  canShowBus: boolean;
  canShowBike: boolean;
  canShowClinic: boolean;
  canShowBarrierFree: boolean;
  canShowKids: boolean;
  canShowSurroundings: boolean;
  canShowAir: boolean;
  onBack: () => void;
}) {
  const t = useTranslations();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const geo = useGeolocation();
  const userCoords = geo.status === "ready" ? geo.coords : null;
  const activePanel = useSyncExternalStore(
    subscribeNearbyPanel,
    getActiveNearbyPanel,
    getServerActiveNearbyPanel,
  );

  // 뷰 전환 포커스 이동(접근성 1급 — PlaceDetail·DirectionsView와 동형 rAF 패턴).
  useEffect(() => {
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Esc = 뒤로가기. 아코디언 패널 점유 중엔 그 패널 Esc가 우선(경합 차단).
  useEffect(() => {
    if (activePanel !== null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, onBack]);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium underline"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t("directions.back")}
      </button>
      <h2 ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-semibold">
        {t("nearby.hubTitle")}
      </h2>
      {/* 날씨·공기질 — 홈에서 이동. 좌표 준비 시 자동 등장 region(계약 유지). */}
      {canShowAir && userCoords && (
        <div className="mt-4">
          <LocalConditions lat={userCoords.lat} lng={userCoords.lng} />
        </div>
      )}
      {canShowWhereAmI && (
        <div className="mt-4">
          <WhereAmI />
        </div>
      )}
      {canShowSubway && (
        <div className="mt-4">
          <SubwayArrivalsNearby />
        </div>
      )}
      {canShowBus && (
        <div className="mt-4">
          <BusArrivals mode="current" />
        </div>
      )}
      {canShowBike && (
        <div className="mt-4">
          <BikeStations mode="current" />
        </div>
      )}
      {canShowClinic && (
        <div className="mt-4">
          <NightClinicsNearby />
        </div>
      )}
      {canShowBarrierFree && (
        <div className="mt-4">
          <BarrierFreeNearby />
        </div>
      )}
      {canShowKids && (
        <div className="mt-4">
          <KidsPlacesNearby />
        </div>
      )}
      {canShowSurroundings && (
        <div className="mt-4">
          <SurroundingsNearby />
        </div>
      )}
      {/* 게이트 없음(음향신호기=무인증 seed, OSM=무키 공개 인스턴스) — 항상 노출. */}
      <div className="mt-4">
        <WalkInfraNearby />
      </div>
    </div>
  );
}
