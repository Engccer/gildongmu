/**
 * 무장애 편의시설(`BarrierFreeInfo` 컴포넌트) 줄 조립 — 라벨+값 단일 텍스트.
 *
 * 라벨은 응답의 `key`를 `barrierFreeInfo.facility.*`로 매핑한다(A26 — 서버 `label`은 한글 합성이라
 * en 화면에 그대로 노출됐다). 모르는 key(서버가 화이트리스트를 늘린 뒤 웹이 아직 못 따라간 창)는
 * 서버 라벨로 폴백한다 — 빈 라벨보다 한글 라벨이 낫다. 값은 서버 원문(한국어 서술)이라 줄 전체는
 * 어느 로케일에서도 `lang="ko"`다.
 */
import { isBarrierFreeFieldKey } from "../barrier-free-fields";
import type { BarrierFreeDetail } from "../types";
import type { TranslateFn } from "./translate";

export interface BarrierFreeLine {
  label: string;
  value: string;
  /** 화면 한 줄 그대로(`라벨 값`) */
  text: string;
}

export function barrierFreeLines(d: BarrierFreeDetail, t: TranslateFn): BarrierFreeLine[] {
  return d.facilities.map((f) => {
    const label = isBarrierFreeFieldKey(f.key) ? t(`facility.${f.key}`) : f.label;
    return { label, value: f.value, text: `${label} ${f.value}` };
  });
}
