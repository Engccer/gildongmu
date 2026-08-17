"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkTightLists } from "@/lib/chat/remark-tight-lists";
import type { AddressMatch, JusoAddress, Place } from "@/lib/types";
import type { ChatMessage, RenderPayload } from "@/lib/chat/types";
import { jusoAddressToPlace } from "@/lib/address-to-place";
import { dataLocale } from "@/lib/data-locale";
import { requestOpenPlace } from "@/lib/place-open-request";
import { ResultList } from "@/components/ResultList";
import { AddressResultList } from "@/components/AddressResultList";
import { SubwayArrivalsNearby } from "@/components/SubwayArrivalsNearby";
import { NightClinicsNearby } from "@/components/NightClinicsNearby";
import { KidsPlacesNearby } from "@/components/KidsPlacesNearby";
import { SurroundingsNearby } from "@/components/SurroundingsNearby";
import { BusArrivals } from "@/components/BusArrivals";
import { BikeStations } from "@/components/BikeStations";
import { AirQuality } from "@/components/AirQuality";
import { StationMeta } from "@/components/StationMeta";
import { StationFacilities } from "@/components/StationFacilities";
import { SeoulMetroFacilities } from "@/components/SeoulMetroFacilities";
import { CarRouteBriefing } from "@/components/CarRouteBriefing";
import { TransitRouteBriefing } from "@/components/TransitRouteBriefing";
import { WebResults } from "@/components/WebResults";
import { BarrierFreeNearby } from "@/components/BarrierFreeNearby";
import { SourceList } from "./SourceList";

/**
 * 채팅 메시지 1건 렌더.
 * - 사용자 메시지: 오른쪽 정렬 텍스트.
 * - 어시스턴트 메시지: 텍스트 + 선택적 RenderBlock(render payload 디스패치).
 *
 * @param onOpenPlace - 장소 카드 클릭 시 상세 진입 콜백. 미주입 시 requestOpenPlace
 *   (place-open-request 모듈 싱글턴 브릿지)로 발행해 PlaceSearch가 상세를 연다.
 * @param isLastQuery - 이 메시지가 가장 최근 사용자 질문인지. true면 lastQueryRef를 연결해
 *   응답 완료 후 포커스가 이 heading으로 이동한다(턴별 탐색).
 * @param lastQueryRef - 최신 질문 heading 참조(ChatInterface가 포커스 이동에 사용).
 */
export function MessageBubble({
  message,
  onOpenPlace,
  isLastQuery,
  lastQueryRef,
}: {
  message: ChatMessage;
  onOpenPlace?: (place: Place) => void;
  isLastQuery?: boolean;
  lastQueryRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "text-right" : "text-left"}>
      {/* 사용자 질문은 heading — 회전자 heading 점프로 대화 턴을 순회하고,
          응답 완료 시 포커스가 최신 질문으로 이동하는 앵커가 된다.
          tabIndex=-1: 프로그램적 포커스만 받고 Tab 순회엔 끼지 않는다. */}
      {message.text &&
        (isUser ? (
          <h2
            ref={isLastQuery ? lastQueryRef : undefined}
            tabIndex={-1}
            className="whitespace-pre-wrap font-medium"
          >
            {message.text}
          </h2>
        ) : (
          // 어시스턴트 산문은 마크다운으로 렌더 — Gemini가 출력한 **굵게**·- 목록·
          // [링크](url) 등이 시맨틱 HTML(strong·ul·li·a)로 변환된다(평문 기호 노출 제거).
          // remarkTightLists: loose list의 <li><p> 중첩을 제거해 iOS VoiceOver 이중 낭독 차단.
          // prose: 목록 마커·강조 등 시각 스타일(Tailwind preflight 리셋 복구), 미니멀 여백.
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-a:text-accent">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkTightLists]} components={markdownComponents}>
              {message.text}
            </ReactMarkdown>
          </div>
        ))}
      {message.renders?.map((render, i) => (
        <RenderBlock key={i} render={render} onOpenPlace={onOpenPlace} />
      ))}
      {/* 어시스턴트 메시지에만 출처 푸터 표시 */}
      {!isUser && <SourceList sources={message.sources} />}
    </div>
  );
}

/**
 * 채팅 답변 마크다운 헤딩(#/##/...)을 강조 단락으로 다운그레이드.
 * 답변 내부 소제목을 페이지 heading으로 렌더하면 회전자 heading 내비를 오염시킨다
 * (질문 h2·"내 주변" h3/h4 사이에 끼어듦) — 시각 강조(font-semibold)만 남기고
 * heading 시맨틱을 제거한다(미니멀 접근성: 산문 답변은 문서가 아니라 한 호흡의 글).
 */
function MarkdownHeading({ children }: { children?: ReactNode }) {
  return <p className="font-semibold">{children}</p>;
}
const markdownComponents = {
  h1: MarkdownHeading,
  h2: MarkdownHeading,
  h3: MarkdownHeading,
  h4: MarkdownHeading,
  h5: MarkdownHeading,
  h6: MarkdownHeading,
};

/**
 * render payload 타입에 따라 적절한 컴포넌트로 디스패치.
 */
function RenderBlock({
  render,
  onOpenPlace,
}: {
  render: RenderPayload;
  onOpenPlace?: (place: Place) => void;
}) {
  const tChat = useTranslations("chat");
  switch (render.type) {
    case "places":
      return (
        <>
          {/* 리뷰순 묶음 캡션 — 정확도순 묶음과 한 답변에 공존할 때 낭독의 유일한 경계
              (iOS renderHeading "네이버 리뷰순 N곳" 미러, spec 2026-08-17 §5.3). 정확도순
              묶음은 종전대로 무캡션. */}
          {render.sort === "review" && (
            <p className="mt-2 font-semibold">
              {tChat("reviewPlacesHeading", { count: render.places.length })}
            </p>
          )}
          <ResultList
            places={render.places}
            onOpen={onOpenPlace ?? requestOpenPlace}
          />
        </>
      );
    case "addresses":
      return <ChatAddressResults addresses={render.results} />;
    case "web-results":
      return <WebResults results={render.results} />;
    case "subway-nearby":
      return <SubwayArrivalsNearby />;
    case "clinics-nearby":
      return <NightClinicsNearby />;
    case "barrier-free-nearby":
      return <BarrierFreeNearby autoLoad />;
    case "kids-nearby":
      return <KidsPlacesNearby />;
    case "surroundings-nearby":
      return <SurroundingsNearby />;
    case "bus":
      return render.mode === "current"
        ? <BusArrivals mode="current" />
        : <BusArrivals mode="place" lat={render.lat} lng={render.lng} />;
    case "bike":
      return render.mode === "current"
        ? <BikeStations mode="current" />
        : <BikeStations mode="place" lat={render.lat} lng={render.lng} />;
    case "air-quality":
      return <AirQuality lat={render.lat} lng={render.lng} />;
    case "station-meta":
      return <StationMeta stationName={render.stationName} />;
    case "station-facilities":
      return (
        <>
          <StationFacilities stationName={render.stationName} />
          <SeoulMetroFacilities stationName={render.stationName} />
        </>
      );
    case "car-route":
      return <CarRouteBriefing dest={render.dest} />;
    case "transit-route":
      return <TransitRouteBriefing dest={render.dest} />;
    default:
      return null;
  }
}

/**
 * 채팅 주소 카드 — 선택 시 카카오 지오코딩으로 좌표를 확보해 requestOpenPlace로
 * 상세를 연다(PlaceSearch onSelectAddress와 동형). 채팅엔 검색 live region이
 * 없으므로 좌표 변환 실패 통지는 이 카드 지역의 단일 채널로만 낸다.
 *
 * aliveRef: 좌표 지오코딩 왕복 중 오버레이가 닫히면(Esc·뒤로가기) 이 컴포넌트가
 * 언마운트된다 — 그 뒤 도착한 응답이 requestOpenPlace를 발행하면 사용자가 이미
 * 떠난 화면에 유령 상세를 열고 포커스를 낚아챈다(헌장 §6 ⑨ 이탈 게이트 계열).
 * 언마운트 후 도착한 성공·실패 모두 폐기한다.
 */
function ChatAddressResults({ addresses }: { addresses: JusoAddress[] }) {
  const t = useTranslations("search");
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  const resolvingRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    return () => {
      aliveRef.current = false;
    };
  }, []);
  async function onSelect(addr: JusoAddress) {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setFailed(false);
    try {
      const target = addr.roadAddrPart1 || addr.roadAddr;
      const res = await fetch(`/api/geocode?query=${encodeURIComponent(target)}&limit=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { matches: AddressMatch[] };
      const coord = data.matches[0];
      if (!aliveRef.current) return;
      if (!coord) {
        setFailed(true);
        return;
      }
      requestOpenPlace(
        jusoAddressToPlace(addr, { lat: coord.lat, lng: coord.lng }, dataLocale(locale)),
      );
    } catch {
      if (aliveRef.current) setFailed(true);
    } finally {
      resolvingRef.current = false;
    }
  }
  return (
    <>
      <AddressResultList addresses={addresses} onSelect={onSelect} />
      <p aria-live="polite" role="status" className="min-h-5 text-sm">
        {failed ? t("addressCoordFailed") : ""}
      </p>
    </>
  );
}
