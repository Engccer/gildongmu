import { z } from "zod";
import { haversineMeters } from "./geo";

/**
 * 판정에 쓰는 실측 fix. `accuracy`는 미터, `at`은 epoch seconds.
 *
 * ⚠ iOS `horizontalAccuracy`는 무효 fix에 **음수**를 준다. 음수를 그대로 빼면
 * separation이 커져 거짓 이동이 되므로 `accuracy > 0`이 자격 조건이다.
 */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
}

/**
 * 사용자가 직접 지정한 현재 위치.
 *
 * `origin`은 **지정 시점의 적격 실측 fix**이고 이동 판정의 기준점이다.
 * `{lat,lng}`(장소 좌표)를 기준점으로 쓰지 않는다 — 장소 검색 결과 좌표는
 * 건물 중심이나 대표 출입구라 사용자가 서 있는 지점과 100m 이상 떨어질 수
 * 있고(지하철역·대형 병원·공원), 그러면 같은 자리인데 이동으로 판정된다.
 * 지정 시점에 적격 fix가 없으면 `null`이고 판정은 `undecidable`이 된다.
 */
export interface ManualLocation {
  /** 단조 증가. 판정 왕복 중 재지정을 가르는 CAS 토큰. */
  revision: number;
  label: string;
  lat: number;
  lng: number;
  origin: Fix | null;
  setAt: number;
}

export type ManualVerdict = "keep" | "drop" | "undecidable";

/**
 * 답이 달라지는 거리(m). `LocationFix.swift`가 "100m가 최근접 정류소 순위를
 * 뒤집는다"를 두 번 기록했다. 답이 달라지는 거리가 곧 "이동했다"의 정의다.
 */
export const MOVED_M = 100;

/**
 * 판정용 fix의 사용 자격 상한(m). `LocationFixPolicy.storeCeiling`과 같은
 * 값·같은 취지(셀·Wi-Fi 측위의 km급 좌표는 어떤 용도로도 위치가 아니다).
 *
 * ⚠ `MOVED_M`과 값은 같지만 **축이 다르다**(답이 달라지는 거리 / 사용 자격).
 * 하나로 합치면 다음 사람이 한 축만 조정하려다 둘 다 바꾼다.
 */
export const JUDGE_CEILING_M = 100;

/**
 * 판정용 fix의 나이 상한(초). `LocationFixPolicy.acceptAge` 미러.
 * `force:true`는 신선도를 보장하지 않는다 — iOS는 매니저 시작 직후 캐시 fix를
 * 먼저 전달할 수 있다.
 */
export const FIX_MAX_AGE_S = 10;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isEligibleFix(fix: Fix, nowSeconds: number): boolean {
  if (!isFiniteNumber(fix.accuracy) || fix.accuracy <= 0) return false;
  if (fix.accuracy > JUDGE_CEILING_M) return false;
  if (!isFiniteNumber(fix.lat) || !isFiniteNumber(fix.lng)) return false;
  if (fix.lat < -90 || fix.lat > 90 || fix.lng < -180 || fix.lng > 180) return false;
  if (!isFiniteNumber(fix.at)) return false;
  return nowSeconds - fix.at <= FIX_MAX_AGE_S;
}

/**
 * 수동 위치를 유지할지, 이동으로 보고 해제할지, 판정할 수 없는지.
 *
 * `separation`은 "두 오차 원이 겹치지 않고도 남는 거리"다. 중심점 거리만 보면
 * 거리 101m·정확도 100m가 이동으로 판정되는데, 그 경우 수동 좌표는 fix의 오차
 * 원 안에 있어 이동의 증거가 아니다. `JUDGE_CEILING_M`은 fix의 **사용 자격**만
 * 가를 뿐 이동을 **증명**하지 않는다.
 */
export function judgeManualLocation(
  manual: ManualLocation,
  fix: Fix | null,
  nowSeconds: number,
): ManualVerdict {
  if (!manual.origin) return "undecidable";
  if (!fix) return "undecidable";
  if (!isEligibleFix(fix, nowSeconds)) return "undecidable";

  const centerDistance = haversineMeters(fix.lat, fix.lng, manual.origin.lat, manual.origin.lng);
  const separation = centerDistance - fix.accuracy - manual.origin.accuracy;
  return separation > MOVED_M ? "drop" : "keep";
}

const fixSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive(),
  at: z.number().finite(),
});

const manualLocationSchema = z.object({
  revision: z.number().finite(),
  label: z.string().trim().min(1),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  origin: fixSchema.nullable(),
  setAt: z.number().finite(),
});

/**
 * 저장 경계 검증. 손상된 값을 복원하면 `haversineMeters`가 NaN을 내고 모든
 * 비교가 false가 되어 **영구 유지**된다(가장 나쁜 실패 방향). 실패는 폐기.
 */
export function parseManualLocation(raw: unknown): ManualLocation | null {
  const parsed = manualLocationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
