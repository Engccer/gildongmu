import { haversineMeters } from "../geo";
import type { Coord } from "../types";

/**
 * 입구 검색에서 고른 역·정류장이 여정의 어느 쪽 갈아탈 곳인지 앱이 짐작한다(E77 판정 3, spec
 * `2026-11-07-e77-unified-waypoint-input-design.md` §2.1) — 순수 함수, Kit `journeyTransferGuess` 미러(공유 fixture
 * `journey-transfer-guess.json`).
 *
 * - `"board"`: 자동차로 이동하다가 그 장소에서 대중교통으로 갈아탄다(승차 쪽 칸 「자동차에서 내리는 …」).
 * - `"alight"`: 대중교통을 이용하다가 그 장소에서 내려 자동차로 갈아탄다(하차 쪽 칸 「자동차를 탈 …」).
 *
 * 출발지·도착지 좌표가 둘 다 있고 도착지까지 직선거리가 **엄격히** 더 짧을 때만 `"alight"`. 좌표가 하나라도 없거나 거리가
 * 같으면 `"board"`(위원장 판정 — 「자동차로 이동하다가」 쪽이 기본).
 */
export type JourneyTransferSide = "board" | "alight";

/** 질문·버튼 문장의 수단 낱말(판정 4): 지하철역 「지하철」, 기차역 「기차」, 버스 정류장 「버스」. */
export type JourneyTransferMode = "subway" | "rail" | "bus";

export function journeyTransferGuess(
  place: Coord,
  origin: Coord | null,
  dest: Coord | null,
): JourneyTransferSide {
  if (!origin || !dest) return "board";
  const toOrigin = haversineMeters(place.lat, place.lng, origin.lat, origin.lng);
  const toDest = haversineMeters(place.lat, place.lng, dest.lat, dest.lng);
  return toDest < toOrigin ? "alight" : "board";
}
