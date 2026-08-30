/**
 * 역 첫차·막차(`StationTimetable` 컴포넌트) 줄 조립 — 화면과 도구가 같은 문장을 읽는다.
 */
import { joinText } from "../format";
import type { StationTimetable, TimetableLineCoverage, TimetableTrain } from "../types";
import type { TranslateFn } from "./translate";

export interface TimetableLineItem {
  /** 노선 표시명 */
  line: string;
  /** 도메인 상태는 문장 안 낱말이 아니라 구조 필드로(spec §3.3) */
  coverage: TimetableLineCoverage;
  /** coverage === "ok"일 때만 — 방향별 첫차·막차 문구(시각 + 종착) */
  first?: string;
  last?: string;
  direction?: "up" | "down";
  /** 화면 한 줄 그대로 */
  text: string;
}

/** 서비스데이 문장 + 불완전 결과 표기(있을 때만) */
export function timetableHeaderLine(tt: StationTimetable, t: TranslateFn): string {
  return joinText(t(`dailyType.${tt.dailyType}`), tt.partial && t("partial"));
}

/**
 * ok 노선은 방향마다 한 항목, 그 밖의 coverage는 노선명을 담은 사유 문장 한 항목.
 * 매칭된 노선은 어떤 상태에서도 빠지지 않는다(A19).
 */
export function timetableLineItems(
  tt: StationTimetable,
  t: TranslateFn,
  isEn: boolean,
): TimetableLineItem[] {
  // 계약 밖 값(미래 추가·서버 선행)은 가장 덜 단정적인 "확인 불가"로(iOS coverageText 동형).
  const coverageKey = (c: string) => (c === "unavailable" || c === "noTrains" ? c : "unknown");
  const train = (v: TimetableTrain) => {
    const time = v.nextDay ? `${t("nextDay")} ${v.time}` : v.time;
    const terminus = isEn && v.terminusEn ? v.terminusEn : v.terminus;
    return terminus ? `${time} ${t("toTerminus", { terminus })}` : time;
  };
  // 서버가 "선"을 덧붙인 노선(lineCore)은 접미를 자기 언어로 단다(A26). 노선명 자체는 원문.
  const lineOf = (line: { lineName: string; lineCore?: string }) =>
    line.lineCore ? t("lineSuffixed", { name: line.lineCore }) : line.lineName;
  return tt.lines.flatMap((line): TimetableLineItem[] => {
    const lineName = lineOf(line);
    return line.coverage === "ok"
      ? line.directions.map((d) => {
          const first = train(d.first);
          const last = train(d.last);
          return {
            line: lineName,
            coverage: line.coverage,
            direction: d.direction,
            first,
            last,
            text: joinText(
              `${lineName} ${t(`direction.${d.direction}`)}`,
              `${t("first")} ${first}`,
              `${t("last")} ${last}`,
            ),
          };
        })
      : [
          {
            line: lineName,
            coverage: line.coverage,
            text: t(`coverage.${coverageKey(line.coverage)}`, { line: lineName }),
          },
        ];
  });
}
