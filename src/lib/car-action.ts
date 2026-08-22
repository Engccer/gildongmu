/**
 * Tmap 자동차 `turnType` → 결정 지점 행동 분류(순수, ko 무관). Kit 미러:
 * `CarAction.swift` — 공유 fixture(`car-action-cases.json`)가 코드 표를 동조한다.
 *
 * 도보(`walkStepAction`)는 문장을 보지만 자동차는 **코드**를 본다(spec
 * `2026-08-23-car-guidance-completion-design.md` §2.1): Tmap 문장의 "오른쪽 방향"은
 * 회전이 아니라 갈래 선택이고(turnType 117, 코퍼스 48%가 같은 도로로 이어진다),
 * 재작성 규칙이 바뀌면 문장 판정이 함께 흔들린다. 코드를 투영하면 낭독 문장
 * (`rewriteCarGuidance`)과 행동 판정이 분리된다.
 *
 * 집합은 낭독 문구·소리를 가르는 단위만이다. **표에 없는 코드는 null** — 미분류의
 * 결과는 오안내가 아니라 침묵(도보 분류기 계약 동형). 코퍼스(`tmap-car-corpus.json`
 * 212문장) 관측 코드는 전부 표에 있고, 102·105·112·115·131~141은 미관측이지만 Tmap 공식
 * 코드표(readme.io "경로안내 샘플예제" — 2026-08-23 확인)의 좌우 대칭·시계 방위 코드라 넣는다.
 * 43/44(차선 오른쪽/왼쪽)·71~76(출구·갈림길)은 공식 표에 번호별 의미가 모호해 null로 둔다.
 */

/**
 * `WalkAction`의 부분집합 + 갈래 선택 2종. `back`은 유턴이다(도보의 "뒤로 돌기"와
 * 같은 소리·같은 키 — 문구만 수단별로 갈린다).
 */
export type CarAction = "left" | "right" | "back" | "keepLeft" | "keepRight";

export function carActionFromTurnType(turnType: number): CarAction | null {
  switch (turnType) {
    case 12: // 좌회전
    case 16: // 8시 방향 좌회전(공식 표의 어휘가 "좌회전"이다 — 갈래가 아니라 회전)
    case 17: // 10시 방향 좌회전
      return "left";
    case 13: // 우회전
    case 18: // 2시 방향 우회전
    case 19: // 4시 방향 우회전
      return "right";
    case 14: // U턴
    case 136: // 6시 방향
      return "back";
    case 118: // 왼쪽 방향(갈래)
    case 102: // 왼쪽 고속도로 입구
    case 105: // 왼쪽 고속도로 출구
    case 112: // 왼쪽 도시고속도로 입구
    case 115: // 왼쪽 도시고속도로 출구
      return "keepLeft";
    case 117: // 오른쪽 방향(갈래)
    case 101: // 오른쪽 고속도로 입구
    case 104: // 오른쪽 고속도로 출구
    case 111: // 오른쪽 도시고속도로 입구
    case 114: // 오른쪽 도시고속도로 출구
      return "keepRight";
    default:
      // 시계 방위 131(1시)~142(12시, 공식 표 — 130은 토끼굴 진입): 1~5시 오른쪽, 7~11시 왼쪽,
      // 6시는 위에서 back, 12시 직진. ⚠ 182·183은 "도착안내 왼쪽/오른쪽 방향"(목적지가 어느
      // 쪽인가)이지 회전이 아니다 — 표에 없으므로 null(설계 리뷰 B2·M8, 공식 표로 확정).
      if (turnType >= 131 && turnType <= 135) return "keepRight";
      if (turnType >= 137 && turnType <= 141) return "keepLeft";
      return null;
  }
}
