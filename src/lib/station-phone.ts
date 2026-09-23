import type { Place } from "./types";

/**
 * 역 장소 상세 개편(E44) 판정 — Kit `StationPhone.swift`의 웹 미러(spec
 * docs/superpowers/specs/2026-09-17-station-detail-reorg-design.md §3.1·§5.4-5).
 * 케이스는 fixture `station-layout-cases.json`(Kit 테스트 케이스를 옮긴 표), Kit 상수와의 일치는 `station-phone-line-table-drift.test.ts`.
 *
 * 웹에는 경유역 상세 진입이 없어 경유역 번호 조회(`pickStationPhone`)는 옮기지 않는다 — 역 상세 전화는 카카오 POI
 * 자기 번호뿐이다(spec §5.2).
 */

/** 역 상세 레이아웃 종류. `isStation`보다 좁다 — 출구 POI·시공업체·이름만 `역`으로 끝나는 장소는 null(현행 레이아웃). */
export type StationLayoutKind = "subway" | "rail";

export function stationLayoutKind(place: Pick<Place, "id" | "category">): StationLayoutKind | null {
  if (place.id.startsWith("transit-stop:")) return "subway";
  const segments = place.category.split(">").map((s) => s.trim());
  const last = segments[segments.length - 1];
  // 마지막 조각이 `지하철,전철`이면 네이버 병합 역 POI의 뭉개진 분류라 역 상세가 아니다.
  if (segments.includes("지하철,전철") && last !== "지하철출구" && last !== "지하철,전철") return "subway";
  if (segments.includes("기차역")) return "rail";
  return null;
}

export const REPRESENTATIVE_PHONE_DIGITS = 8;
export const REPRESENTATIVE_PHONE_PREFIXES = ["15", "16", "18"];

/** 전국 대표번호(15xx·16xx·18xx 8자리) — 운영사 대표번호는 "대표번호"라고 밝힌다(판정 ⑥). */
export function isRepresentativePhone(phone: string): boolean {
  const digits = phone.replace(/[^0-9]/g, "");
  return (
    digits.length === REPRESENTATIVE_PHONE_DIGITS &&
    REPRESENTATIVE_PHONE_PREFIXES.includes(digits.slice(0, 2))
  );
}

/** 역 상세에서 "대표번호"라고 밝힐 번호인가 — 화면 전화 줄과 WebMCP `phoneKind`가 같이 쓴다. 비역 장소는 현행 그대로(거짓). */
export function isRepresentativeStationPhone(place: Pick<Place, "id" | "category" | "phone">): boolean {
  return stationLayoutKind(place) !== null && !!place.phone && isRepresentativePhone(place.phone);
}
