import { env } from "./env";
import {
  fetchNightClinics,
  rankClinicsByDistance,
  clinicOpenStatus,
  clinicNowBasis,
  kstDateKey,
  prioritizeOpen,
  type ClinicHoursBasis,
  type NightClinicNow,
} from "./providers/night-clinic";
import { fetchPediatricClinicsBySido } from "./providers/pediatric-clinics";
import { fetchIsHoliday } from "./providers/holiday";
import { scanSidos } from "./region-scan";

/**
 * 소아 진료 병합 진입점 — 달빛 지정 명부 + 일반 소아청소년과 보완 소스.
 * 라우트(`/api/clinic/nearby`)·채팅(`get_night_clinics`)의 유일한 진입점이다
 * (`bus.ts`의 TAGO+TOPIS 병합과 동형). 상태 부여를 한 곳으로 모아 LLM이
 * 진료시간 배열을 보고 "지금 진료중"을 추론(=날조)하지 못하게 막는다.
 *
 * **두 소스의 반경이 다른 것은 결함이 아니라 성격 차이다.**
 * - 지정 명부(달빛어린이병원, 153건): "소아 야간진료" 품질 보증이 붙어 있어
 *   차로 가는 거리(20km)가 정당하다.
 * - 보완 소스(QD=D002 일반 소아과): 명부 커버리지가 6.5%뿐이라 넣지만(강동
 *   실측 — 1.2km 안 소아과 3곳 전부 명부 부재), 야간진료 보증이 없는 동네
 *   의원에 20km 전제는 성립하지 않는다 → 좁은 반경(3km).
 * UI는 이 구분(designated)과 절단(total)을 숨기지 않는다.
 *
 * **실패 비대칭(3-state)**: 지정 명부 실패는 throw(정본 소스 — "조회 실패"를
 * 빈 목록으로 위장하지 않는다). 보완 소스 실패는 `supplementFailed=true`로
 * 표기하고 지정 명부만 반환한다(metro-facilities의 보강 실패 표기와 동형 —
 * 실패 은폐 금지, 단 보강이 정본을 죽이지도 않는다).
 */

/** 지정 명부(달빛) 반경 — 야간 소아 응급, 차량 이동 전제. */
const DESIGNATED_RADIUS_METERS = 20_000;
/** 보완 소스(일반 소아과) 반경 — 동네 의원 도보·단거리 전제(V1). */
const SUPPLEMENT_RADIUS_METERS = 3_000;
/**
 * 서버 반환 상한 — 표시 절단(초기 10, "더 보기" +10)은 웹·iOS 클라이언트 몫.
 * 재조회 없이 단계 공개하기 위해 반경 내 전량을 근사로 실어 보낸다(50 초과는
 * 밀집 지역 폭주 방어 — total이 절단 전 수를 계속 보존한다).
 */
const SERVER_CAP = 50;

export interface ClinicsNowResult {
  /** 진료중 우선(open>unknown>closed), 같은 상태 안에서는 거리순. 상위 N. */
  clinics: NightClinicNow[];
  /** 병합·dedupe 후 전체 수(절단 전) — 침묵 절단 금지. */
  total: number;
  /** 지정 명부(달빛) 분 — 반경 radiusMeters 내. */
  designatedTotal: number;
  /** 보완 소스 분(dedupe 후) — 반경 supplementRadiusMeters 내. */
  supplementTotal: number;
  radiusMeters: number;
  supplementRadiusMeters: number;
  /** 진료 상태를 어느 진료시간 칸으로 읽었는지(공휴일/요일). */
  basis: ClinicHoursBasis;
  /** 보완 소스 조회 실패 — 지정 명부만 반환됐음을 UI가 밝힌다(은폐 금지). */
  supplementFailed: boolean;
}

/**
 * 보완 소스: 좌표 반경이 걸치는 시도를 스캔해 소아청소년과 전량을 합친다.
 * 시도 스캔은 카카오 역지오코딩을 쓰므로 카카오 키가 게이트다(키 없으면
 * 기능 0 — mock 폴백 금지). 시도 전멸(빈 배열)은 스캔 실패로 취급한다.
 */
async function fetchSupplement(lat: number, lng: number): Promise<{
  clinics: ReturnType<typeof rankClinicsByDistance>;
  failed: boolean;
}> {
  if (!env.KAKAO_REST_API_KEY) return { clinics: [], failed: false };
  try {
    const sidos = await scanSidos({ lat, lng }, SUPPLEMENT_RADIUS_METERS);
    if (sidos.length === 0) return { clinics: [], failed: true };
    const perSido = await Promise.all(
      sidos.map((sido) => fetchPediatricClinicsBySido(sido)),
    );
    const within = rankClinicsByDistance(perSido.flat(), lat, lng, {
      radiusMeters: SUPPLEMENT_RADIUS_METERS,
      limit: Number.POSITIVE_INFINITY,
    });
    return { clinics: within, failed: false };
  } catch (e) {
    console.warn("[clinics] 일반 소아과 보완 조회 실패 — 지정 명부만 반환", e);
    return { clinics: [], failed: true };
  }
}

/** 좌표 → 지정+보완 병합 소아 진료 + 지금 진료 상태(KST·공휴일 반영). */
export async function findNightClinicsNow(
  lat: number,
  lng: number,
  opts: { nowMs?: number; radiusMeters?: number; limit?: number } = {},
): Promise<ClinicsNowResult> {
  const radiusMeters = opts.radiusMeters ?? DESIGNATED_RADIUS_METERS;
  const limit = opts.limit ?? SERVER_CAP;
  const nowMs = opts.nowMs ?? Date.now();
  if (!env.DATA_GO_KR_API_KEY) {
    return {
      clinics: [],
      total: 0,
      designatedTotal: 0,
      supplementTotal: 0,
      radiusMeters,
      supplementRadiusMeters: SUPPLEMENT_RADIUS_METERS,
      basis: "weekday",
      supplementFailed: false,
    };
  }

  const [designatedAll, supplement, isHoliday] = await Promise.all([
    fetchNightClinics(), // 실패는 throw — 정본 소스
    fetchSupplement(lat, lng),
    fetchIsHoliday(kstDateKey(nowMs)),
  ]);

  // 반경 내 전량을 먼저 확보해야 total(절단 전 수)이 정확하다.
  const designated = rankClinicsByDistance(designatedAll, lat, lng, {
    radiusMeters,
    limit: Number.POSITIVE_INFINITY,
  });

  // dedupe는 hpid — 지정 명부가 이긴다(품질 보증 라벨 보존).
  const designatedIds = new Set(designated.map((c) => c.id));
  const supplementOnly = supplement.clinics.filter(
    (c) => !designatedIds.has(c.id),
  );

  // 병합 후 거리순 재정렬 — prioritizeOpen의 안정 정렬이 "같은 상태 안 거리순"
  // 을 보존하려면 입력이 거리순이어야 한다(두 소스를 이어붙인 채 두면 깨진다).
  const merged = [...designated, ...supplementOnly].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );

  const now = clinicNowBasis(nowMs, isHoliday);
  const withStatus: NightClinicNow[] = merged.map((c) => ({
    ...c,
    openStatus: clinicOpenStatus(c.hours, now.hoursIndex, now.hhmm),
  }));

  return {
    clinics: prioritizeOpen(withStatus, limit),
    total: merged.length,
    designatedTotal: designated.length,
    supplementTotal: supplementOnly.length,
    radiusMeters,
    supplementRadiusMeters: SUPPLEMENT_RADIUS_METERS,
    basis: now.basis,
    supplementFailed: supplement.failed,
  };
}
