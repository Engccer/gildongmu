"use client";

import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Copy, MessageSquare, Route } from "lucide-react";
import type { Place } from "@/lib/types";
import { isStation } from "@/lib/station-match";
import { isRepresentativeStationPhone, stationLayoutKind } from "@/lib/station-phone";
import { hasHangul } from "@/lib/format";
import { pickCategory } from "@/lib/kakao-category";
import { PlaceBridgeContext } from "@/hooks/useAxisBridge";
import { createAxisRegistry } from "@/lib/webmcp/place-axes";
import { isUnwinding, publishView, withdrawView } from "@/lib/webmcp/view-registry";
import type { PlaceBridge } from "@/lib/webmcp/tools/context";
import { RouteLinks } from "./RouteLinks";
import { PlaceHoursLine } from "./PlaceHoursLine";
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
  onOpenDirectionsFrom,
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
  /** 있으면 "여기부터 길찾기" 버튼 노출: 이 장소를 출발지로 길찾기 뷰 전환(E32) */
  onOpenDirectionsFrom?: () => void;
  onBack: () => void;
}) {
  const t = useTranslations();
  // 분류 표시(A28): 비-ko는 서버 `categoryEn` 우선, 없으면 원문 + lang="ko". 채팅 컨텍스트·isStation은 원문.
  const displayCategory = pickCategory(useLocale(), place);
  const bilingualTitle = useBilingualName()(place.name, { roman: place.nameRoman });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 채팅 오버레이 열림 상태 + 트리거 버튼 ref(닫을 때 포커스 복귀 대상).
  const [chatOpen, setChatOpen] = useState(false);
  // 역 레이아웃의 메타 출처 줄 표시(메타가 보일 때만, StationMeta가 알린다).
  const [stationMetaShown, setStationMetaShown] = useState(false);
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
  // 역 섹션 로드·도구 축은 넓은 `isStation`, 화면 배치는 좁은 `stationLayoutKind`(E44 §3.1) — 출구 POI·"철도" 업체·
  // 이름만 "역"으로 끝나는 장소가 역 모양이 되지 않게. 역 레이아웃이면 isStation도 참이다(station-phone.test.ts).
  const isStationPlace = isStation(place);
  const layoutKind = stationLayoutKind(place);
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
          phoneKind: isRepresentativeStationPhone(p) ? "representative" : undefined,
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

  // ── 두 레이아웃이 공유하는 조각. 비역 분기는 개편 전 순서 그대로 이 조각들을 늘어놓는다. ──

  // 카카오 분류가 en 페이지에서 한국어로 남으면(categoryEn 부재) 줄 전체에 lang="ko"(A26).
  const categoryLine = (
    <p lang={hasHangul(displayCategory) ? "ko" : undefined}>
      {`${t("place.category")} ${displayCategory}`}
    </p>
  );

  // 주소는 종류마다 한 줄 + 그 줄 전용 복사 버튼. 도로명과 지번은 쓰임이 달라(택배·행정서식) 둘 다 복사할 수
  // 있어야 하고, 복사 대상은 반드시 화면에 보이는 줄과 일치한다. 라벨+주소는 단일 텍스트로 합쳐 한 객체로
  // 낭독(라벨 볼드 분절 포기). 한글 주소 줄엔 lang="ko"(영문 UI에서도 정확히 읽히게).
  // 복사 통지 전용 live region은 주소 줄을 감싸지 않는다. 감싸면 장소를 바꿀 때(PlaceDetail 인스턴스 재사용)
  // 주소 변경이 통째로 재낭독돼, 이미 보이는 콘텐츠를 중복 낭독하게 된다. 내용 없는 빈 컨테이너는 SR 탐색을
  // 멈추지 않는다.
  const addressBlock = (
    <>
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
      <div aria-live="polite">
        {copyAnnouncement && (
          <span key={copyAnnouncement.id} className="sr-only">
            {copyAnnouncement.message}
          </span>
        )}
      </div>
    </>
  );

  // 역 상세에서만 운영사 대표번호(1544-7788 등)를 "대표번호"라고 밝힌다(E44 판정 ⑥) — 역무실 직통으로
  // 오해하지 않게. 번호는 링크 안에 두어 링크 목록에서도 대표번호임이 들린다. 비역 장소는 현행 그대로.
  const phoneLine = place.phone && (
    <p>
      {`${t("place.phone")} `}
      <a href={`tel:${place.phone}`} className="underline">
        {isRepresentativeStationPhone(place)
          ? t("place.representativePhone", { phone: place.phone })
          : place.phone}
      </a>
    </p>
  );

  // 길찾기 두 방향(E32). 별개 버튼 = 별개 접근성 객체이고, 각 라벨이 그 버튼이 채우는 끝(도착지·출발지)을
  // 말한다. "여기부터"는 도착지가 비어 있으므로 조회하지 않고 도착지 입력에 착지한다.
  const directionsButtons = (
    <>
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
      {onOpenDirectionsFrom && (
        <button
          type="button"
          onClick={onOpenDirectionsFrom}
          className="mt-4 mr-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
        >
          <Route aria-hidden="true" className="h-4 w-4" />
          {t("directions.fromHere")}
        </button>
      )}
    </>
  );

  const chatButton = canShowChat && (
    <button
      type="button"
      ref={chatTriggerRef}
      onClick={() => setChatOpen(true)}
      className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent/10"
    >
      <MessageSquare aria-hidden="true" className="h-4 w-4" />
      {t("placeChat.launch")}
    </button>
  );

  // 역 자동 섹션 — 실시간 도착·첫차막차·교통약자 시설 2종(시설은 종류별 접기, E44 §4).
  const stationSections = (
    <>
      {canShowSubway && <SeoulSubwayArrival stationName={place.name} />}
      <StationTimetable stationName={place.name} />
      <StationFacilities stationName={place.name} />
      <SeoulMetroFacilities stationName={place.name} />
    </>
  );

  // 이 장소 주변(버스·따릉이·날씨/공기질). 웹 장소 상세엔 근처 지하철 섹션이 없다(E44 판정 ④와 이미 같다).
  const nearbySections = (
    <>
      {canShowBus && (
        <BusArrivals mode="place" lat={place.lat} lng={place.lng} />
      )}
      {canShowBike && (
        <BikeStations mode="place" lat={place.lat} lng={place.lng} />
      )}
      {canShowAir && <LocalConditions lat={place.lat} lng={place.lng} />}
    </>
  );

  const barrierFree = canShowBarrierFree && (
    <BarrierFreeInfo lat={place.lat} lng={place.lng} name={place.name} />
  );

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

        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-2xl font-bold"
          lang={langFor(bilingualTitle.primary)}
        >
          {bilingualTitle.primary}
          <KoTail secondary={bilingualTitle.secondary} />
        </h2>

        {layoutKind ? (
          <>
            {/* 역 상세(E44 §3.2): 역 정보 → 도착·시간표·시설 → 무장애 → 길찾기 → 이 장소 주변(최하단).
                "역 정보" 제목은 조회 결과와 무관하게 항상 서고, 전화 줄이 맨 위다("가장 많이 쓸 메뉴"). */}
            <h3 className="mt-4 text-base font-semibold">{t("stationMeta.heading")}</h3>
            <div className="mt-1 text-sm leading-relaxed">
              {phoneLine}
              <StationMeta stationName={place.name} embedded onShownChange={setStationMetaShown} />
              {/* 분류 줄은 기차역만 — `KTX정차역` 같은 정보가 여기뿐이다. 지하철은 메타 줄 노선과 중복. */}
              {layoutKind === "rail" && categoryLine}
              {addressBlock}
              <PlaceHoursLine place={place} />
              {/* 메타 출처는 섹션 끝 — 전화·메타 다음 주소까지의 읽기 흐름을 가르지 않는다. 메타가 없으면 없다. */}
              {stationMetaShown && (
                <p className="mt-2 text-xs opacity-70">{t("stationMeta.source")}</p>
              )}
            </div>
            {chatButton}
            {stationSections}
            {barrierFree}
            {/* 화면 아래로 내려간 길찾기는 제목으로 점프한다(E44 §3.2 7). */}
            <h3 className="mt-6 text-base font-semibold">{t("directions.title")}</h3>
            {directionsButtons}
            <RouteLinks place={place} />
            {/* 이 장소 주변(E44 §3.2 8)은 최하단 — 제목이 없으면 버스·따릉이 버튼이 길찾기 묶음에 섞여 읽힌다. */}
            {(canShowBus || canShowBike || canShowAir) && (
              <h3 className="mt-6 text-base font-semibold">{t("place.nearbyHeading")}</h3>
            )}
            {nearbySections}
          </>
        ) : (
          <>
            {/* 정의 리스트(dl/dt/dd) 대신 평문 단락 — 스크린 리더가 항목마다 "용어/정의"
              역할과 콜론을 별도 낭독하던 노이즈를 제거한다(라벨은 볼드 시각 구분만).
              "분류 음식점"처럼 한 호흡에 읽힌다(First Rule of ARIA). */}
            <div className="mt-2 text-sm leading-relaxed">
              {categoryLine}
              {addressBlock}
              {/* 영업시간(E24): 전화 줄 바로 앞 — 시각이 틀릴 수 있어 확인 경로와 짝짓는다(iOS 미러). */}
              <PlaceHoursLine place={place} />
              {phoneLine}
            </div>

            <RouteLinks place={place} />
            {directionsButtons}
            {chatButton}
            {/* 넓은 isStation이 레이아웃 밖에서 참인 드문 경우(출구 POI 등) — 역 섹션만 종전 자리에 조용히 나타난다. */}
            {isStationPlace && (
              <>
                <StationMeta stationName={place.name} />
                {stationSections}
              </>
            )}
            {nearbySections}
            {barrierFree}
          </>
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
