"use client";

import type { RefObject } from "react";
import type { Place } from "@/lib/types";
import type { ChatMessage, RenderPayload } from "@/lib/chat/types";
import { ResultList } from "@/components/ResultList";
import { groupByCategory } from "@/lib/category";
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
import { SourceList } from "./SourceList";

/**
 * 채팅 메시지 1건 렌더.
 * - 사용자 메시지: 오른쪽 정렬 텍스트.
 * - 어시스턴트 메시지: 텍스트 + 선택적 RenderBlock(render payload 디스패치).
 *
 * @param onOpenPlace - 장소 카드 클릭 시 상세 진입 콜백. V1 채팅은 비목표 → 미주입 시 no-op.
 *   후속 Task에서 PlaceSearch openDetail과 연결 예정.
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
          <p className="whitespace-pre-wrap">{message.text}</p>
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
 * render payload 타입에 따라 적절한 컴포넌트로 디스패치.
 */
function RenderBlock({
  render,
  onOpenPlace,
}: {
  render: RenderPayload;
  onOpenPlace?: (place: Place) => void;
}) {
  switch (render.type) {
    case "places":
      return (
        <ResultList
          groups={groupByCategory(render.places)}
          // onOpenPlace 미주입 시 no-op: ResultList는 필수 콜백 요구,
          // 상세 진입 와이어링은 후속 Task에서 처리.
          onOpen={onOpenPlace ?? (() => {})}
        />
      );
    case "addresses":
      return (
        <AddressResultList
          addresses={render.results}
          // 채팅 V1: 상세 진입 비목표 → no-op (후속 Task에서 연결)
          onSelect={() => {}}
        />
      );
    case "subway-nearby":
      return <SubwayArrivalsNearby />;
    case "clinics-nearby":
      return <NightClinicsNearby />;
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
