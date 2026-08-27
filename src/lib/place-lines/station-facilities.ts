/**
 * 코레일 역 교통약자 시설(`StationFacilities` 컴포넌트) 줄 조립 — 화면 `<li>` 4줄과 동일.
 */
import type { StationFacilities } from "../types";
import type { TranslateFn } from "./translate";

/** 화장실·경사로는 유무, 리프트·엘리베이터는 수(undefined = 정보 없음, 0과 구분). */
export function korailFacilityLines(f: StationFacilities, t: TranslateFn): string[] {
  return [
    `${t("accessibleToilet")}: ${f.accessibleToilet ? t("yes") : t("no")}`,
    `${t("accessibleSlope")}: ${f.accessibleSlope ? t("yes") : t("no")}`,
    `${t("wheelchairLifts")}: ${f.wheelchairLifts ?? t("unknown")}`,
    `${t("elevators")}: ${f.elevators ?? t("unknown")}`,
  ];
}
