import { awaitGeolocation, type GeoState, type LocateOptions } from "./geolocation";
import { judgeManualLocation, type Fix, type ManualLocation } from "./manual-location";
import { clearManualLocation, getManualLocation, setManualVerdict } from "./manual-location-store";

/**
 * **실측위로만 생산되는** fix. 브랜드 필드가 구조적 타이핑을 막아, 수동 좌표로
 * 만든 객체가 실시간 안내 경로에 들어갈 수 없게 한다.
 *
 * ⚠ 초판 설계는 함수 이름(`awaitGeolocation` vs `awaitEffectiveLocation`)으로
 * 막으려 했으나 **이름은 값의 출처를 따라가지 못한다.** 길찾기 조회에서 얻은
 * 수동 좌표가 route state에 저장되면, 안내 시작 함수에 `awaitEffectiveLocation`
 * 호출이 없어도 그 state를 재사용하는 경로로 수동 좌표가 안내에 들어간다.
 */
export interface RealFix extends Fix {
  readonly __source: "real";
}

/** 조회에 쓰는 유효 위치. 출처가 값에 실린다. */
export interface EffectiveLocation {
  lat: number;
  lng: number;
  source: "gps" | "manual";
}

type Announcer = ((verdict: "drop") => void) | null;
let announcer: Announcer = null;

/**
 * 자동 해제 통지 채널. UI 계층이 단일 polite live region을 물린다.
 *
 * ⚠ 자동 해제는 반드시 통지한다. 포커스 밖 텍스트 변경을 VoiceOver는 읽지
 * 않으므로 "표시줄이 말한다"는 사용자가 그 줄로 돌아갈 때만 성립하고,
 * 표시줄이 없는 화면(장소 상세·길찾기)에서 복귀하면 아예 만나지 못한다.
 */
export function setManualJudgmentAnnouncer(fn: Announcer): void {
  announcer = fn;
}

function toRealFix(state: GeoState): RealFix | null {
  if (state.status !== "ready") return null;
  return {
    lat: state.coords.lat,
    lng: state.coords.lng,
    // 정확도가 없는 좌표(구버전 저장분·정확도 미제공 브라우저)는 판정 자격
    // 상한과 같은 값으로 취급한다 — 이 값이 separation에서 차감되므로 판정은
    // 보수적(유지 쪽)으로 기운다.
    accuracy: state.coords.accuracy ?? 100,
    // 스토어가 보관한 fix 취득 시각(A7).
    //
    // ⚠ **없으면 `NaN`이다 — 지금으로 도장을 찍지 않는다.** 나이를 모르는 좌표를
    // "방금 잰 것"으로 승격하면 판정 나이 상한(10초)을 무조건 통과해 옛 자리로 이동
    // 판정을 내린다. `isEligibleFix`가 비유한 `at`을 거부하므로 이 값은 `undecidable`
    // 로 떨어진다 — 증거 부재를 유지로 읽는 안전한 방향이고, 같은 커밋의
    // `isStaleCoord`("나이 불명 = 낡음")와도 방향이 같다(독립 리뷰 지적).
    at: state.coords.at ?? NaN,
    __source: "real",
  };
}

/**
 * 실좌표 전용. 실시간 안내(시작·이탈 재조회·자동차 ETA)만 이 함수를 쓴다.
 * 수동 위치를 절대 보지 않는다.
 */
export async function awaitRealFix(opts: LocateOptions): Promise<RealFix | null> {
  const state = await awaitGeolocation(opts);
  return toRealFix(state);
}

/**
 * 판정 1회. 트리거 3종(포그라운드 복귀 · force 조회 · 앱/탭 시작)이 호출한다.
 *
 * ⚠ 캐시를 읽으면 판정이 성립하지 않는다. 공유 스토어는 TTL이 없어 `ready`
 * 좌표가 세션 최초 값이므로 이동을 영영 놓친다. 그래서 항상 `force:true`다.
 */
export async function runManualLocationJudgment(): Promise<void> {
  const manual = getManualLocation();
  if (!manual) return;
  // origin이 없으면 어떤 fix로도 판정할 수 없다 — 측위 비용을 치르지 않는다.
  // 결과는 기록한다: 라벨은 `undecidable`을 `keep`과 구분해야 한다(3-state).
  if (!manual.origin) {
    setManualVerdict("undecidable");
    return;
  }

  const captured = manual.revision;
  // silent: 이 측위는 **화면이 요청한 것이 아니다**(포그라운드 복귀 트리거). 공유
  // 스토어를 `locating`으로 되돌리면 그 좌표를 쓰는 섹션이 언마운트·재마운트된다
  // (백로그 D19).
  //
  // ⚠ silent 실패는 직전 `ready`를 그대로 두므로 **여기서 옛 좌표를 받을 수 있다.**
  // 그것이 안전한 이유는 좌표에 취득 시각(`at`)이 실려 있고 `isEligibleFix`가 나이
  // 상한(10초)으로 거르기 때문이다 — 옛 fix는 판정 자격을 잃어 `undecidable`이 된다
  // (증거 부재를 유지로 읽는 안전한 방향). `at`이 없던 시절이라면 이 조합이 옛 자리로
  // 판정하는 결함이 됐다.
  const fix = await awaitRealFix({ force: true, silent: true });
  const verdict = judgeManualLocation(manual, fix, Date.now() / 1000);

  // CAS: 판정 왕복 중 사용자가 새 위치를 지정했으면 늦게 온 옛 판정이 그것을
  // 지운다(또는 그 위치의 라벨을 정한다). revision이 같을 때만 반영한다.
  if (getManualLocation()?.revision !== captured) return;

  if (verdict !== "drop") {
    // ⚠ 결과를 버리면 라벨이 `origin` 유무만 보게 되어, **지금** 판정할 수 없는
    // 상태(권한 철회·실내 측위 실패)가 검증 가능형으로 낭독된다(spec §4.5).
    setManualVerdict(verdict);
    return;
  }

  clearManualLocation();
  announcer?.("drop");
}

/**
 * 판정을 거친 뒤 **지금 유효한 수동 위치**를 준다. 없으면 null이고, 그때
 * 호출부가 자기 GPS 경로를 그대로 탄다.
 *
 * `force:true`는 "지금 어디 있는가"를 다시 묻는 행동이므로 수동 위치라도
 * 판정을 동반한다. 이것이 없으면 앱을 켠 채 걸어가는 동안 복귀 트리거가 영영
 * 발화하지 않아 옛 자리로 계속 조회한다.
 *
 * ⚠ **GPS 실패 상태를 이 함수로 흡수하지 않는 것이 의도다.** 실패 분기는
 * 호출부마다 계약이 다르고(직전 데이터 복원·unsupported/denied 구분), 여기서
 * null 하나로 뭉개면 그 구분이 호출부에서 재구성 불가능해진다.
 */
export async function awaitManualLocation(opts: LocateOptions): Promise<ManualLocation | null> {
  if (opts.force) await runManualLocationJudgment();
  return getManualLocation();
}

/**
 * 조회용 유효 위치. 검색 거리·채팅 앵커·길찾기 출발지처럼 "좌표 아니면 없음"
 * 두 갈래로 충분한 소비자가 쓴다. GPS 실패 사유를 갈라야 하는 곳은
 * `awaitManualLocation` + 자기 GPS 경로를 쓴다.
 */
export async function awaitEffectiveLocation(opts: LocateOptions): Promise<EffectiveLocation | null> {
  const manual = await awaitManualLocation(opts);
  if (manual) return { lat: manual.lat, lng: manual.lng, source: "manual" };

  const state = await awaitGeolocation(opts);
  if (state.status !== "ready") return null;
  return { lat: state.coords.lat, lng: state.coords.lng, source: "gps" };
}
