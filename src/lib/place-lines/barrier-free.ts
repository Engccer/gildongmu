/**
 * 무장애 편의시설(`BarrierFreeInfo` 컴포넌트) 줄 조립 — 라벨+값 단일 텍스트.
 */
import type { BarrierFreeDetail } from "../types";

export interface BarrierFreeLine {
  label: string;
  value: string;
  /** 화면 한 줄 그대로(`라벨 값`) */
  text: string;
}

export function barrierFreeLines(d: BarrierFreeDetail): BarrierFreeLine[] {
  return d.facilities.map((f) => ({ label: f.label, value: f.value, text: `${f.label} ${f.value}` }));
}
