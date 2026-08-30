"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, MessageSquare, Route } from "lucide-react";
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { hasHangul } from "@/lib/format";
import { PlaceBridgeContext } from "@/hooks/useAxisBridge";
import { createAxisRegistry } from "@/lib/webmcp/place-axes";
import { isUnwinding, publishView, withdrawView } from "@/lib/webmcp/view-registry";
import type { PlaceBridge } from "@/lib/webmcp/tools/context";
import { RouteLinks } from "./RouteLinks";
import { StationMeta } from "./StationMeta";
import { StationTimetable } from "./StationTimetable";
import { StationFacilities } from "./StationFacilities";
import { SeoulMetroFacilities } from "./SeoulMetroFacilities";
import { SeoulSubwayArrival } from "./SeoulSubwayArrival";
import { BusArrivals } from "./BusArrivals";
import { BikeStations } from "./BikeStations";
import { LocalConditions } from "./LocalConditions";
import { BarrierFreeInfo } from "./BarrierFreeInfo";
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
 * 그린다. 경로 미리 듣기는 "여기까지 길찾기"(DirectionsView, 3수단 비교)로
 * 일원화 — 상세 안 단일 수단 브리핑 진입점은 중복이라 제거(2026-07-30).
 */
export function PlaceDetail({
  place,
  canShowBus,
  canShowBike,
  canShowSubway,
  canShowAir,
  canShowBarrierFree,
  canShowChat = false,
  onOpenDirections,
  onBack,
}: {
  place: Place;
  canShowBus: boolean;
  canShowBike: boolean;
  canShowSubway: boolean;
  canShowAir: boolean;
  canShowBarrierFree: boolean;
  canShowChat?: boolean;
  /** 있으면 "여기까지 길찾기" 버튼 노출: 이 장소를 도착지로 길찾기 뷰 전환 */
  onOpenDirections?: () => void;
  onBack: () => void;
}) {
  const t = useTranslations();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 채팅 오버레이 열림 상태 + 트리거 버튼 ref(닫을 때 포커스 복귀 대상).
  const [chatOpen, setChatOpen] = useState(false);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  // 복사 성공 때만 기존 주소 행의 live region에 통지 문구를 추가한다. 평상시에는
  // 빈 status 요소를 남기지 않아 스크린 리더 탐색 중 불필요한 정지를 만들지 않는다.
  const [copyAnnouncement, setCopyAnnouncement] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const copyAnnouncementIdRef = useRef(0);
  const copyAnnouncementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    // 도구 언와인드(홈으로 되돌아가기) 중의 재마운트는 중간 화면이다 — 착지하지 않는다(spec §6.1).
    if (isUnwinding()) return;
    headingRef.current?.focus();
  }, [place.id]);

  // ── WebMCP `PlaceBridge` 게시(spec §5.4) ──
  // 축 엔트리 6개는 여기서 만들고 `present`는 props에서 게시 시점에 확정한다. 자식 역 섹션은
  // `useAxisBridge`로 상태 소스·load만 채운다. 정착 통지는 자식이 자기 커밋 뒤에 낸다(useAxisBridge), 언마운트는
  // 대기자 전부 aborted(teardown). 한 마운트 = 한 레지스트리(key 리마운트가 곧 새 장소).
  const isStationPlace = isStation(place);
  const axisRegistry = useMemo(() => createAxisRegistry(), []);
  const placeRef = useRef(place);
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => {
    placeRef.current = place;
    chatOpenRef.current = chatOpen;
  }, [place, chatOpen]);
  useEffect(() => {
    const stationAxis = (present: boolean) => ({
      present,
      absentOutcome: "notApplicable" as const,
    });
    const bridge: PlaceBridge = {
      placeId: place.id,
      read: () => {
        const p = placeRef.current;
        return {
          name: p.name,
          category: p.category,
          isStation: isStationPlace,
          addressLines: {
            english: p.englishAddress || undefined,
            road: p.roadAddress || undefined,
            jibun: p.address || undefined,
          },
          phone: p.phone || undefined,
          chatOpen: chatOpenRef.current,
        };
      },
      axes: {
        // 비역의 basic은 역 메타 소스가 없는 것이 정답 — attach를 기다리지 않는다.
        basic: axisRegistry.makeEntry("basic", {
          present: true,
          kind: "mount",
          absentOutcome: "notApplicable",
          settleWithoutSource: isStationPlace
            ? undefined
            : { status: "notApplicable", gen: 0 },
        }),
        timetable: axisRegistry.makeEntry("timetable", {
          ...stationAxis(isStationPlace),
          kind: "mount",
        }),
        facilities: axisRegistry.makeEntry("facilities", {
          ...stationAxis(isStationPlace),
          kind: "trigger",
        }),
        facilitiesMetro: axisRegistry.makeEntry("facilitiesMetro", {
          ...stationAxis(isStationPlace),
          kind: "trigger",
        }),
        // 화면 게이트가 있는 두 축만 키 게이트 → notConfigured(비역이면 notApplicable이 먼저).
        arrivals: axisRegistry.makeEntry("arrivals", {
          present: isStationPlace && canShowSubway,
          kind: "trigger",
          absentOutcome: isStationPlace ? "notConfigured" : "notApplicable",
        }),
        barrierFree: axisRegistry.makeEntry("barrierFree", {
          present: canShowBarrierFree,
          kind: "mount",
          absentOutcome: "notConfigured",
        }),
      },
    };
    publishView("place", bridge, place.id);
    return () => withdrawView("place", bridge);
  }, [
    axisRegistry,
    place.id,
    isStationPlace,
    canShowSubway,
    canShowBarrierFree,
  ]);
  useEffect(() => {
    // StrictMode 이중 effect(마운트→cleanup→마운트)에서 useMemo 레지스트리는 같은 객체라 재무장이 필요하다.
    axisRegistry.arm();
    return () => axisRegistry.teardown();
  }, [axisRegistry]);
  useEffect(() => {
    return () => {
      if (copyAnnouncementTimerRef.current) {
        clearTimeout(copyAnnouncementTimerRef.current);
      }
    };
  }, []);

  // 주소 종류(영문·도로명·지번)마다 버튼이 있으므로 복사 대상을 인자로 받는다.
  const copyAddress = useCallback(
    async (address: string) => {
      try {
        await navigator.clipboard.writeText(address);
      } catch {
        return;
      }
      const announcementId = ++copyAnnouncementIdRef.current;
      setCopyAnnouncement({
        id: announcementId,
        message: t("place.addressCopied"),
      });
      if (copyAnnouncementTimerRef.current) {
        clearTimeout(copyAnnouncementTimerRef.current);
      }
      copyAnnouncementTimerRef.current = setTimeout(() => {
        setCopyAnnouncement((current) =>
          current?.id === announcementId ? null : current,
        );
        copyAnnouncementTimerRef.current = null;
      }, 2000);
    },
    [t],
  );

  // 보유한 주소만 줄로 낸다(빈 주소 = 죽은 복사 버튼). en 검색 결과는 영문 주소가
  // 메인이라 맨 위, 한글 도로명·지번이 뒤따른다.
  const addressLines = [
    place.englishAddress && {
      key: "english",
      label: t("place.address"),
      value: place.englishAddress,
      copyLabel: t("place.copyEnglishAddress"),
      korean: false,
    },
    place.roadAddress && {
      key: "road",
      label: t("place.roadAddress"),
      value: place.roadAddress,
      copyLabel: t("place.copyRoadAddress"),
      korean: true,
    },
    place.address && {
      key: "jibun",
      label: t("place.jibunAddress"),
      value: place.address,
      copyLabel: t("place.copyJibunAddress"),
      korean: true,
    },
  ].filter((line) => typeof line === "object");

  return (
    <PlaceBridgeContext.Provider value={axisRegistry.registrar}>
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
          {/* 카카오 분류는 en 페이지에서도 한국어 — 줄 전체에 lang="ko"(주소 줄과 같은 판정, A26). */}
          <p lang={hasHangul(place.category) ? "ko" : undefined}>
            {`${t("place.category")} ${place.category}`}
          </p>
          {/* 주소는 종류마다 한 줄 + 그 줄 전용 복사 버튼. 도로명과 지번은 쓰임이
            달라(택배·행정서식) 둘 다 복사할 수 있어야 하고, 복사 대상은 반드시
            화면에 보이는 줄과 일치한다. 라벨+주소는 단일 텍스트로 합쳐 한 객체로
            낭독(라벨 볼드 분절 포기). 한글 주소 줄엔 lang="ko"(영문 UI에서도 정확히
            읽히게). */}
          {addressLines.map(({ key, label, value, copyLabel, korean }) => (
            <div key={key} className="flex w-fit max-w-full items-start gap-2">
              <p className="min-w-0" lang={korean ? "ko" : undefined}>
                {`${label} ${value}`}
              </p>
              <button
                type="button"
                onClick={() => copyAddress(value)}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-start justify-center gap-1 pt-0.5 text-xs font-medium text-accent"
              >
                <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                {copyLabel}
              </button>
            </div>
          ))}
          {/* 복사 통지 전용 live region — 주소 줄을 감싸지 않는다. 감싸면 장소를 바꿀 때
            (PlaceDetail 인스턴스 재사용) 주소 변경이 통째로 재낭독돼, 이미 보이는
            콘텐츠를 중복 낭독하게 된다. 내용 없는 빈 컨테이너는 SR 탐색을 멈추지 않는다. */}
          <div aria-live="polite">
            {copyAnnouncement && (
              <span key={copyAnnouncement.id} className="sr-only">
                {copyAnnouncement.message}
              </span>
            )}
          </div>
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
        {onOpenDirections && (
          <button
            type="button"
            onClick={onOpenDirections}
            className="mt-4 mr-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
          >
            <Route aria-hidden="true" className="h-4 w-4" />
            {t("directions.toHere")}
          </button>
        )}
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
        {isStation(place) && (
          <>
            <StationMeta stationName={place.name} />
            {canShowSubway && <SeoulSubwayArrival stationName={place.name} />}
            <StationTimetable stationName={place.name} />
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
          <BarrierFreeInfo lat={place.lat} lng={place.lng} name={place.name} />
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
    </PlaceBridgeContext.Provider>
  );
}
