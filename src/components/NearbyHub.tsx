"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import {
  getActiveNearbyPanel,
  getServerActiveNearbyPanel,
  subscribeNearbyPanel,
} from "@/lib/nearby-panel-store";
import { LocationBar } from "./LocationBar";
import { ManualLocationPicker } from "./ManualLocationPicker";
import { WhereAmI } from "./WhereAmI";
import { SubwayArrivalsNearby } from "./SubwayArrivalsNearby";
import { BusArrivals } from "./BusArrivals";
import { BikeStations } from "./BikeStations";
import { NightClinicsNearby } from "./NightClinicsNearby";
import { BarrierFreeNearby } from "./BarrierFreeNearby";
import { KidsPlacesNearby } from "./KidsPlacesNearby";
import { CultureEventsNearby } from "./CultureEventsNearby";
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
  canShowEvents,
  canShowSurroundings,
  canShowAir,
  locationNotice,
  onBack,
}: {
  canShowWhereAmI: boolean;
  canShowSubway: boolean;
  canShowBus: boolean;
  canShowBike: boolean;
  canShowClinic: boolean;
  canShowBarrierFree: boolean;
  canShowKids: boolean;
  canShowEvents: boolean;
  canShowSurroundings: boolean;
  canShowAir: boolean;
  /** 수동 위치 자동 해제 통지(PlaceSearch가 소유·등록 — 이 컴포넌트는 화면 전환에
   * 따라 마운트·언마운트되므로 채널을 자체 등록하지 않는다, `PlaceSearch.tsx` 주석 참조). */
  locationNotice: string;
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
  // "현재 위치 지정" 모달 — 홈과 별개로 이 화면 전용 열림 상태(LocationBar·
  // ManualLocationPicker는 두 화면이 공유하는 정본, 열림 여부만 화면별 로컬).
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  const manualPickerTriggerRef = useRef<HTMLElement | null>(null);

  // 뷰 전환 포커스 이동(접근성 1급 — PlaceDetail·DirectionsView와 동형
  // useEffect+focus 패턴, rAF 불필요: 헤딩이 마운트 시점에 이미 무조건
  // 렌더되어 있어 fetch 콜백 이후 지연 등장하는 요소의 레이스가 없다).
  useEffect(() => {
    headingRef.current?.focus();
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

      <div className="mt-3">
        <LocationBar
          onPick={() => {
            manualPickerTriggerRef.current = document.activeElement as HTMLElement | null;
            setManualPickerOpen(true);
          }}
        />
      </div>
      {manualPickerOpen && (
        <ManualLocationPicker
          onClose={() => {
            setManualPickerOpen(false);
            manualPickerTriggerRef.current?.focus();
          }}
        />
      )}
      {/* 이 허브의 단일 polite 채널 — 지금은 수동 위치 자동 해제 통지 전용
          (허브 자체 결과 통지는 아코디언 패널마다 자기 region을 갖는다). */}
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {locationNotice}
      </p>

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
      {canShowEvents && (
        <div className="mt-4">
          <CultureEventsNearby />
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
