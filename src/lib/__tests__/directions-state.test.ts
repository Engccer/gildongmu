import { describe, it, expect } from "vitest";
import {
  serializeDir,
  parseDir,
  type DirEndpoint,
} from "@/lib/directions-state";

/**
 * 길찾기 `?dir=` 직렬화/파싱 순수 로직 게이트.
 *
 * 핵심 계약:
 * - 왕복(직렬화 → 파싱) 손실 없음. 라벨의 구분자 문자(@, /, 쉼표)도 안전.
 * - 프라이버시: 현재 위치는 `cur` 토큰만. 좌표 숫자를 URL에 싣지 않는다.
 * - 불량 입력은 전부 null(빈 폼 폴백). 부분 파싱·예외 누출 금지.
 * - 부분 상태(`to` 없음) 허용: 홈 진입 직후(출발지만 확정) 공유 가능.
 */

const place = (label: string, lat: number, lng: number): DirEndpoint => ({
  kind: "place",
  label,
  coord: { lat, lng },
});
const CUR: DirEndpoint = { kind: "current" };

describe("serializeDir", () => {
  it("현재 위치는 좌표 없는 'cur' 토큰만 싣는다(프라이버시 계약)", () => {
    const s = serializeDir(CUR, null);
    expect(s).toBe("cur");
    // 어떤 경로로도 좌표 숫자가 섞이면 안 된다.
    expect(serializeDir(CUR, CUR)).not.toMatch(/\d/);
  });

  it("장소는 '라벨@lat,lng' 형태로 직렬화한다", () => {
    const s = serializeDir(CUR, place("경복궁", 37.5796, 126.977));
    expect(s).toContain("@37.5796,126.977");
    expect(decodeURIComponent(s)).toContain("경복궁");
  });

  it("URL-safe: 직렬화 결과에 공백·미인코딩 예약문자가 없다", () => {
    const s = serializeDir(place("이상한 @가게/이름,진짜", 37.1, 127.2), CUR);
    expect(s).not.toMatch(/\s/);
    // 라벨 속 구분자(@, /)는 인코딩되어 구조 구분자와 충돌하지 않는다.
    const [from, to] = s.split("/");
    expect(to).toBe("cur");
    expect(from.split("@")).toHaveLength(2);
  });
});

describe("parseDir", () => {
  it("왕복: 직렬화한 문자열을 그대로 복원한다", () => {
    const from = place("서울역", 37.5547, 126.9707);
    const to = place("이상한 @가게/이름,진짜~!", 35.1796, 129.0756);
    expect(parseDir(serializeDir(from, to))).toEqual({ from, to , via: null });
  });

  it("현재 위치 왕복: cur 토큰이 {kind:'current'}로 복원된다", () => {
    expect(parseDir(serializeDir(CUR, null))).toEqual({ from: CUR, to: null , via: null });
    const dest = place("강동구청", 37.5301, 127.1238);
    expect(parseDir(serializeDir(CUR, dest))).toEqual({ from: CUR, to: dest , via: null });
  });

  it("부분 상태(to 없음)를 허용한다", () => {
    const from = place("길동역", 37.5384, 127.1436);
    expect(parseDir(serializeDir(from, null))).toEqual({ from, to: null , via: null });
  });

  it("음수 좌표도 왕복된다", () => {
    const from = place("남반구 테스트", -33.8688, 151.2093);
    expect(parseDir(serializeDir(from, null))).toEqual({ from, to: null , via: null });
  });

  it("불량 입력은 null: 빈 값·쓰레기·좌표 형식 오류·조각 과다", () => {
    expect(parseDir(null)).toBeNull();
    expect(parseDir("")).toBeNull();
    expect(parseDir("garbage")).toBeNull(); // @ 없는 장소 토큰
    expect(parseDir("a@b,c")).toBeNull(); // 숫자 아닌 좌표
    expect(parseDir("a@37.5")).toBeNull(); // 경도 누락
    expect(parseDir("a@37.5,127.0,9")).toBeNull(); // 좌표 조각 과다
    expect(parseDir("cur/cur/cur")).toBeNull(); // 토큰 3개
    expect(parseDir("@37.5,127.0")).toBeNull(); // 빈 라벨
    expect(parseDir("%E0%A4%A@37.5,127.0")).toBeNull(); // 깨진 퍼센트 인코딩
  });

  describe("via 경유지(N4): from/to/via 세 토막", () => {
    const from = place("천호역", 37.5386, 127.1237);
    const to = place("길동", 37.5272, 127.1268);
    const via = place("강동역 5호선", 37.5353, 127.1323);

    it("via가 있으면 세 번째 토막으로 직렬화하고 왕복한다", () => {
      const s = serializeDir(from, to, via);
      expect(s.split("/")).toHaveLength(3);
      expect(parseDir(s)).toEqual({ from, to, via });
    });

    it("via 없으면 두 토막(현행 불변), 파싱은 via:null", () => {
      expect(serializeDir(from, to).split("/")).toHaveLength(2);
      expect(parseDir(serializeDir(from, to))).toEqual({ from, to, via: null });
      expect(parseDir(serializeDir(from, null))).toEqual({ from, to: null, via: null });
    });

    it("to 없이 via만은 직렬화하지 않는다(경유지는 도착지 없이 의미가 없다)", () => {
      expect(serializeDir(from, null, via).split("/")).toHaveLength(1);
    });

    it("via 토막이 cur·불량이면 전체 null", () => {
      expect(parseDir(`${serializeDir(from, to)}/cur`)).toBeNull();
      expect(parseDir(`${serializeDir(from, to)}/bad`)).toBeNull();
      expect(parseDir("a/b/c/d")).toBeNull();
    });
  });
});
