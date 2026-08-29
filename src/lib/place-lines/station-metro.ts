/**
 * 서울 지하철역 교통약자 시설(`SeoulMetroFacilities` 컴포넌트) 그룹·줄 조립.
 */
import { joinText } from "../format";
import type { SeoulMetroFacilities } from "../types";
import type { TranslateFn } from "./translate";

export interface MetroGroupItem {
  /** 그룹 헤딩(`<h4>`) 문장 — 시설 종류 + 수 */
  name: string;
  /** 시설 한 줄 = 한 객체(이름·위치·층·설명·가동현황 쉼표 결합) */
  lines: string[];
}

export function metroFacilityGroups(f: SeoulMetroFacilities, t: TranslateFn): MetroGroupItem[] {
  return f.groups.map((g) => ({
    name: `${t(`kind.${g.kind}`)} ${t("count", { count: g.facilities.length })}`,
    // 필드가 전부 빈 항목(교통약자 도우미 — upstream이 수만 준다, 서울역 실측 2026-08-30)은
    // 빈 <li> = SR에 "이름 없는 항목"이라 떨어뜨린다. 수는 그룹 헤딩이 이미 말한다.
    lines: g.facilities
      .map((x) =>
        joinText(
          x.name,
          x.location,
          x.floors,
          x.detail,
          x.operatingStatus &&
            (x.operatingStatus === "normal" ? t("operatingNormal") : t("operatingStopped")),
        ),
      )
      .filter((line) => line.length > 0),
  }));
}
