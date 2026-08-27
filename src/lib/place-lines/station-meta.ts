/**
 * 도시철도역 메타(`StationMeta` 컴포넌트) 줄 조립 — 화면과 도구가 같은 문장을 읽는다.
 */
import { joinText } from "../format";
import type { StationMeta } from "../types";
import type { TranslateFn } from "./translate";

/**
 * [영문역명 줄, 노선 줄(환승이면 배지 텍스트 흡수), 운영기관 줄].
 * 영문역명은 en·ko 모두 같은 문자열이고 로케일 차이는 화면 스타일(주/보조)뿐이라
 * 여기서는 언어를 받지 않는다.
 */
export function stationMetaLines(meta: StationMeta, t: TranslateFn): string[] {
  return [
    meta.nameEn,
    joinText(`${t("lines")} ${meta.lines.join(", ")}`, meta.isTransfer && t("transfer")),
    `${t("operator")} ${meta.operator}`,
  ];
}
