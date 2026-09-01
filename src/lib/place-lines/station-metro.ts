/**
 * 서울 지하철역 교통약자 시설(`SeoulMetroFacilities` 컴포넌트) 그룹·줄 조립.
 */
import { prefersEnglish } from "../data-locale";
import { formatDistance, joinText } from "../format";
import { subwayLineNameEn } from "../subway-line-names";
import type { SeoulMetroFacilities, SeoulMetroFacility } from "../types";
import type { TranslateFn } from "./translate";

export interface MetroGroupItem {
  /** 그룹 헤딩(`<h4>`) 문장 — 시설 종류 + 수 */
  name: string;
  /** 시설 한 줄 = 한 객체(이름·위치·층·설명·가동현황 쉼표 결합) */
  lines: string[];
}

/**
 * 노선 라벨의 정본은 E27 노선명 표(`subway-line-names.ts`)다 — 같은 화면의 역 메타 줄(`linesEn`)이
 * 이미 그 표를 타므로, 여기서만 로케일별 접미를 붙이면 한 화면 안에서 같은 노선이 두 이름으로
 * 읽힌다(es에서 "Línea 5" vs "Line 5"). 비-ko는 전부 영문 데이터를 공유하므로(`prefersEnglish`)
 * 표 값이 그 자리의 답이고, 표 미스·ko만 폴백 문자열을 쓴다.
 *
 * iOS `StationSections.facilityName`은 같은 표를 서버 additive `parts.lineEn`(`lang=en`)으로 받는다 —
 * Kit에 표를 이식하지 않고 라우트가 태운다(2026-09-02).
 */
function lineLabel(koName: string, fallback: string, isEn: boolean): string {
  return (isEn && subwayLineNameEn(koName)) || fallback;
}

/**
 * 서버 합성 한국어(`name`·`detail`) 대신 구조화 조각(`parts`, A26)이 있으면 그것으로 자기 언어
 * 문장을 만든다 — iOS `StationSections` 미러. 부재(구버전 응답·해당 없는 그룹)면 문자열 그대로.
 */
function nameOf(x: SeoulMetroFacility, t: TranslateFn, isEn: boolean): string {
  const p = x.parts;
  if (p?.compass && p.meters !== undefined) {
    return joinText(
      t("elevatorAt", { direction: t(`direction.${p.compass}`), distance: formatDistance(p.meters) }),
      p.dong,
    );
  }
  if (p?.location) {
    // `parts.line`은 번호만("5") 온다 — 표 키는 노선명이라 `호선`을 붙여 조회한다.
    const line = p.line && lineLabel(`${p.line}호선`, t("lineNumber", { line: p.line }), isEn);
    return joinText(p.location, line);
  }
  return x.name;
}

function detailOf(x: SeoulMetroFacility, t: TranslateFn): string | undefined {
  const p = x.parts;
  if (p && (p.restroomType || p.wheelchairAccessible)) {
    return joinText(p.restroomType, p.wheelchairAccessible && t("wheelchairAccessible"));
  }
  return x.detail;
}

/**
 * 결과 헤딩("{역명} 지하철 교통약자 시설, {노선}") — 노선명은 위 표를 탄다.
 * 문장 정본이 place-lines에 있어야 화면과 도구가 같은 줄을 읽는다.
 */
export function metroHeadingLine(
  f: SeoulMetroFacilities,
  fallbackName: string,
  t: TranslateFn,
  locale: string = "ko",
): string {
  const line = f.line && lineLabel(f.line, f.line, prefersEnglish(locale));
  return joinText(t("heading", { name: f.stationName || fallbackName }), line);
}

export function metroFacilityGroups(
  f: SeoulMetroFacilities,
  t: TranslateFn,
  locale: string = "ko",
): MetroGroupItem[] {
  const isEn = prefersEnglish(locale);
  return f.groups.map((g) => ({
    name: `${t(`kind.${g.kind}`)} ${t("count", { count: g.facilities.length })}`,
    // 필드가 전부 빈 항목(교통약자 도우미 — upstream이 수만 준다, 서울역 실측 2026-08-30)은
    // 빈 <li> = SR에 "이름 없는 항목"이라 떨어뜨린다. 수는 그룹 헤딩이 이미 말한다.
    lines: g.facilities
      .map((x) =>
        joinText(
          nameOf(x, t, isEn),
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
