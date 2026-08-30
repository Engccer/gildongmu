/**
 * 서울 지하철역 교통약자 시설(`SeoulMetroFacilities` 컴포넌트) 그룹·줄 조립.
 */
import { formatDistance, joinText } from "../format";
import type { SeoulMetroFacilities, SeoulMetroFacility } from "../types";
import type { TranslateFn } from "./translate";

export interface MetroGroupItem {
  /** 그룹 헤딩(`<h4>`) 문장 — 시설 종류 + 수 */
  name: string;
  /** 시설 한 줄 = 한 객체(이름·위치·층·설명·가동현황 쉼표 결합) */
  lines: string[];
}

/**
 * 서버 합성 한국어(`name`·`detail`) 대신 구조화 조각(`parts`, A26)이 있으면 그것으로 자기 언어
 * 문장을 만든다 — iOS `StationSections` 미러. 부재(구버전 응답·해당 없는 그룹)면 문자열 그대로.
 */
function nameOf(x: SeoulMetroFacility, t: TranslateFn): string {
  const p = x.parts;
  if (p?.compass && p.meters !== undefined) {
    return joinText(
      t("elevatorAt", { direction: t(`direction.${p.compass}`), distance: formatDistance(p.meters) }),
      p.dong,
    );
  }
  if (p?.location) return joinText(p.location, p.line && t("lineNumber", { line: p.line }));
  return x.name;
}

function detailOf(x: SeoulMetroFacility, t: TranslateFn): string | undefined {
  const p = x.parts;
  if (p && (p.restroomType || p.wheelchairAccessible)) {
    return joinText(p.restroomType, p.wheelchairAccessible && t("wheelchairAccessible"));
  }
  return x.detail;
}

export function metroFacilityGroups(f: SeoulMetroFacilities, t: TranslateFn): MetroGroupItem[] {
  return f.groups.map((g) => ({
    name: `${t(`kind.${g.kind}`)} ${t("count", { count: g.facilities.length })}`,
    // 필드가 전부 빈 항목(교통약자 도우미 — upstream이 수만 준다, 서울역 실측 2026-08-30)은
    // 빈 <li> = SR에 "이름 없는 항목"이라 떨어뜨린다. 수는 그룹 헤딩이 이미 말한다.
    lines: g.facilities
      .map((x) =>
        joinText(
          nameOf(x, t),
          x.location,
          x.floors,
          detailOf(x, t),
          x.operatingStatus &&
            (x.operatingStatus === "normal" ? t("operatingNormal") : t("operatingStopped")),
        ),
      )
      .filter((line) => line.length > 0),
  }));
}
