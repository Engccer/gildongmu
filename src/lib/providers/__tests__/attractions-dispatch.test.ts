import { describe, it, expect, vi, beforeEach } from "vitest";

// env 게이트를 제어해 소스 키 유무별 디스패처 분기를 검증한다.
// 빈 결과(死기능 0) 경로는 fetch를 하지 않으므로 fetch mock 없이 검증 가능.
vi.mock("../../env", () => ({
  hasKakaoKey: vi.fn(),
  hasTourApiKey: vi.fn(),
}));
// 실제 소스 provider는 호출되면 안 되는(빈 결과) 경로만 테스트하므로 스텁.
vi.mock("../kakao-attractions", () => ({
  searchAttractionsKakao: vi.fn(async () => ({
    places: [{ id: "k" }],
    provider: "kakao-attractions",
    query: "",
  })),
}));
vi.mock("../tour-api", () => ({
  searchAttractionsTourApi: vi.fn(async () => ({
    places: [{ id: "t" }],
    provider: "tour-api",
    query: "",
  })),
}));

import { searchAttractions } from "../attractions";
import { hasKakaoKey, hasTourApiKey } from "../../env";
import { searchAttractionsKakao } from "../kakao-attractions";
import { searchAttractionsTourApi } from "../tour-api";

const mockKakaoKey = vi.mocked(hasKakaoKey);
const mockTourKey = vi.mocked(hasTourApiKey);

describe("searchAttractions 디스패처 게이트", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("카카오 키 없음 + ko → 카카오 fetch 시도 없이 빈 결과(死기능 0, throw 아님)", async () => {
    mockKakaoKey.mockReturnValue(false);
    mockTourKey.mockReturnValue(true); // TourAPI 키만 살아있는 독립 시나리오
    const out = await searchAttractions({ query: "경복궁", lang: "ko" });
    expect(out.places).toEqual([]);
    expect(out.provider).toBe("none");
    // 카카오를 KakaoAK undefined로 호출하지 않는다.
    expect(searchAttractionsKakao).not.toHaveBeenCalled();
  });

  it("두 소스 키 모두 없음 → 빈 결과", async () => {
    mockKakaoKey.mockReturnValue(false);
    mockTourKey.mockReturnValue(false);
    const out = await searchAttractions({ query: "x", lang: "en" });
    expect(out.provider).toBe("none");
    expect(searchAttractionsKakao).not.toHaveBeenCalled();
    expect(searchAttractionsTourApi).not.toHaveBeenCalled();
  });

  it("en + TourAPI 키 → TourAPI 경로", async () => {
    mockKakaoKey.mockReturnValue(true);
    mockTourKey.mockReturnValue(true);
    const out = await searchAttractions({ query: "Gyeongbokgung", lang: "en" });
    expect(out.provider).toBe("tour-api");
    expect(searchAttractionsTourApi).toHaveBeenCalledOnce();
    expect(searchAttractionsKakao).not.toHaveBeenCalled();
  });

  it("ko + 카카오 키 → 카카오 경로", async () => {
    mockKakaoKey.mockReturnValue(true);
    mockTourKey.mockReturnValue(true);
    const out = await searchAttractions({ query: "경복궁", lang: "ko" });
    expect(out.provider).toBe("kakao-attractions");
    expect(searchAttractionsKakao).toHaveBeenCalledOnce();
    expect(searchAttractionsTourApi).not.toHaveBeenCalled();
  });

  it("en인데 TourAPI 키 없음 → 카카오 폴백(카카오 키 있으면)", async () => {
    mockKakaoKey.mockReturnValue(true);
    mockTourKey.mockReturnValue(false);
    const out = await searchAttractions({ query: "Gyeongbokgung", lang: "en" });
    expect(out.provider).toBe("kakao-attractions");
    expect(searchAttractionsKakao).toHaveBeenCalledOnce();
  });
});
