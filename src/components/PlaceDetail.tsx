"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, MessageSquare } from "lucide-react";
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { RouteLinks } from "./RouteLinks";
import { CarRouteBriefing } from "./CarRouteBriefing";
import { StationMeta } from "./StationMeta";
import { StationFacilities } from "./StationFacilities";
import { SeoulMetroFacilities } from "./SeoulMetroFacilities";
import { SeoulSubwayArrival } from "./SeoulSubwayArrival";
import { BusArrivals } from "./BusArrivals";
import { BikeStations } from "./BikeStations";
import { LocalConditions } from "./LocalConditions";
import { BarrierFreeInfo } from "./BarrierFreeInfo";
import { TransitRouteBriefing } from "./TransitRouteBriefing";
import { ChatOverlay } from "./chat/ChatOverlay";

/**
 * 장소 상세 뷰 — 같은 페이지에서 검색 결과를 대체해 렌더되는 화면.
 *
 * 접근성 1급 시민:
 * - 진입 시 제목(h2)으로 포커스를 옮겨(`tabIndex={-1}`) 스크린 리더/키보드
 *   사용자가 새 화면 맥락을 잃지 않게 한다.
 * - 주소는 영문(en 검색)을 메인, 한글을 보조(`lang="ko"`)로 표시.
 * - 전화는 `tel:` 링크. 목록 복귀는 lucide ArrowLeft 버튼.
 *
 * 카카오 로컬 API는 ID 단건 조회가 없으므로 상세는 메모리의 Place 객체로만
 * 그린다(추가 fetch는 CarRouteBriefing의 온디맨드 경로뿐).
 */
export function PlaceDetail({
  place,
  canBriefCarRoute,
  canShowBus,
  canShowBike,
  canShowSubway,
  canShowAir,
  canShowBarrierFree,
  canShowTransit,
  canShowChat = false,
  onBack,
}: {
  place: Place;
  canBriefCarRoute: boolean;
  canShowBus: boolean;
  canShowBike: boolean;
  canShowSubway: boolean;
  canShowAir: boolean;
  canShowBarrierFree: boolean;
  canShowTransit: boolean;
  canShowChat?: boolean;
  onBack: () => void;
}) {
  const t = useTranslations();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 채팅 오버레이 열림 상태 + 트리거 버튼 ref(닫을 때 포커스 복귀 대상).
  const [chatOpen, setChatOpen] = useState(false);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  // 주소 복사 통지 전용 announcer(VoiceRecordButton과 동일 패턴) — textContent를
  // 직접 갱신해 React 배칭과 무관하게 즉시 낭독, 2초 뒤 비워 잔상 방지.
  const copyAnnouncerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [place.id]);

  const copyAddress = useCallback(async () => {
    const address = place.englishAddress ?? (place.roadAddress || place.address);
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      return;
    }
    if (copyAnnouncerRef.current) {
      copyAnnouncerRef.current.textContent = t("place.addressCopied");
      setTimeout(() => {
        if (copyAnnouncerRef.current) copyAnnouncerRef.current.textContent = "";
      }, 2000);
    }
  }, [place, t]);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {t("detail.back")}
      </button>

      <h2 ref={headingRef} tabIndex={-1} className="mt-2 text-2xl font-bold">
        {place.name}
      </h2>

      {/* 정의 리스트(dl/dt/dd) 대신 평문 단락 — 스크린 리더가 항목마다 "용어/정의"
          역할과 콜론을 별도 낭독하던 노이즈를 제거한다(라벨은 볼드 시각 구분만).
          "분류 음식점"처럼 한 호흡에 읽힌다(First Rule of ARIA). */}
      <div className="mt-2 text-sm leading-relaxed">
        <p>{`${t("place.category")} ${place.category}`}</p>
        {/* 영문 주소(en 검색)일 땐 "주소"/"Address" 라벨, 한글 도로명일 땐
            "도로명"/"Road address" 라벨 — 주소 종류로 분기. 라벨+주소를 단일
            텍스트로 합쳐 한 객체로 낭독(라벨 볼드 분절 포기). 메인 주소가 한글
            (영문 주소 부재)이면 줄 전체에 lang="ko"(영문 UI에서도 정확히 읽히게). */}
        <p lang={place.englishAddress ? undefined : "ko"}>
          {`${place.englishAddress ? t("place.address") : t("place.roadAddress")} ${place.englishAddress ?? (place.roadAddress || place.address)}`}
        </p>
        {place.englishAddress && (place.roadAddress || place.address) && (
          <p className="mt-0.5 text-xs text-muted" lang="ko">
            {place.roadAddress || place.address}
          </p>
        )}
        <div ref={copyAnnouncerRef} role="status" aria-live="polite" className="sr-only" />
        <button
          type="button"
          onClick={copyAddress}
          className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-accent"
        >
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          {t("place.copyAddress")}
        </button>
        {place.phone && (
          <p>
            {`${t("place.phone")} `}
            <a href={`tel:${place.phone}`} className="underline">
              {place.phone}
            </a>
          </p>
        )}
      </div>

      <RouteLinks place={place} />
      {canShowChat && (
        <button
          type="button"
          ref={chatTriggerRef}
          onClick={() => setChatOpen(true)}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
        >
          <MessageSquare aria-hidden="true" className="h-4 w-4" />
          {t("placeChat.launch")}
        </button>
      )}
      {canBriefCarRoute && (
        <CarRouteBriefing
          dest={{ lat: place.lat, lng: place.lng, name: place.name }}
        />
      )}
      {canShowTransit && (
        <TransitRouteBriefing
          dest={{ lat: place.lat, lng: place.lng, name: place.name }}
        />
      )}
      {isStation(place) && (
        <>
          <StationMeta stationName={place.name} />
          {canShowSubway && <SeoulSubwayArrival stationName={place.name} />}
          <StationFacilities stationName={place.name} />
          <SeoulMetroFacilities stationName={place.name} />
        </>
      )}
      {canShowBus && (
        <BusArrivals mode="place" lat={place.lat} lng={place.lng} />
      )}
      {canShowBike && (
        <BikeStations mode="place" lat={place.lat} lng={place.lng} />
      )}
      {canShowAir && <LocalConditions lat={place.lat} lng={place.lng} />}
      {canShowBarrierFree && (
        <BarrierFreeInfo lat={place.lat} lng={place.lng} name={place.name} canShow={canShowBarrierFree} />
      )}
      {chatOpen && (
        <ChatOverlay
          place={place}
          onClose={() => {
            setChatOpen(false);
            // 닫기 버튼/Esc 공통 — 트리거 버튼으로 포커스 복귀(맥락 유지).
            requestAnimationFrame(() => chatTriggerRef.current?.focus());
          }}
        />
      )}
    </div>
  );
}
