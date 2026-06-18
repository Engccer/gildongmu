import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichEnglishAddresses } from "../providers/places";
import { geocodeEnglishAddress } from "../providers/ncp-geocode";
import { geocodeEnglishAddressJuso } from "../providers/juso-address";
import { hasJusoKey, hasNcpMapsKeys } from "../env";
import type { Place } from "../types";

// places.ts가 ../env에서 import하는 모든 게이트를 명시적으로 mock한다
// (auto-mock 부작용 회피). enrich는 hasJusoKey·hasNcpMapsKeys만 쓴다.
vi.mock("../providers/ncp-geocode");
vi.mock("../providers/juso-address");
vi.mock("../env", () => ({
  hasJusoKey: vi.fn(),
  hasNcpMapsKeys: vi.fn(),
  hasKakaoKey: vi.fn(() => false),
  hasNaverLocalKeys: vi.fn(() => false),
  hasTourApiKey: vi.fn(() => false),
  env: {},
}));

const ncpMock = vi.mocked(geocodeEnglishAddress);
const jusoMock = vi.mocked(geocodeEnglishAddressJuso);
const hasJuso = vi.mocked(hasJusoKey);
const hasNcp = vi.mocked(hasNcpMapsKeys);

function place(over: Partial<Place> & Pick<Place, "id">): Place {
  return {
    name: "",
    category: "",
    address: "지번주소",
    roadAddress: "한글 도로명 주소",
    lat: 37.5,
    lng: 127.0,
    ...over,
  };
}

describe("enrichEnglishAddresses 폴백 체인 (juso 우선 → NCP)", () => {
  beforeEach(() => {
    ncpMock.mockReset();
    jusoMock.mockReset();
    hasJuso.mockReset();
    hasNcp.mockReset();
  });

  it("juso 키 있고 juso 성공 → juso 영문주소, NCP 미호출", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);
    jusoMock.mockResolvedValue("110 Sejong-daero, Jung-gu, Seoul");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(jusoMock).toHaveBeenCalledWith("한글 도로명 주소");
    expect(ncpMock).not.toHaveBeenCalled();
    expect(out.englishAddress).toBe("110 Sejong-daero, Jung-gu, Seoul");
  });

  it("juso null → NCP 폴백 성공", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);
    jusoMock.mockResolvedValue(null);
    ncpMock.mockResolvedValue("161, Sajik-ro, Jongno-gu, Seoul");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(jusoMock).toHaveBeenCalled();
    expect(ncpMock).toHaveBeenCalledWith("한글 도로명 주소");
    expect(out.englishAddress).toBe("161, Sajik-ro, Jongno-gu, Seoul");
  });

  it("juso·NCP 둘 다 null → 한글 주소 유지", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);
    jusoMock.mockResolvedValue(null);
    ncpMock.mockResolvedValue(null);

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBeUndefined();
    expect(out.roadAddress).toBe("한글 도로명 주소");
  });

  it("juso 키 없음 → juso 미호출, NCP만 사용", async () => {
    hasJuso.mockReturnValue(false);
    hasNcp.mockReturnValue(true);
    ncpMock.mockResolvedValue("161, Sajik-ro");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(jusoMock).not.toHaveBeenCalled();
    expect(ncpMock).toHaveBeenCalled();
    expect(out.englishAddress).toBe("161, Sajik-ro");
  });

  it("juso 키만 있고 NCP 키 없음 → juso 성공 시 NCP 미호출", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(false);
    jusoMock.mockResolvedValue("110 Sejong-daero");

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBe("110 Sejong-daero");
    expect(ncpMock).not.toHaveBeenCalled();
  });

  it("juso 키만 있고 juso null → NCP 키 없으면 한글 유지(NCP 미호출)", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(false);
    jusoMock.mockResolvedValue(null);

    const [out] = await enrichEnglishAddresses([place({ id: "kakao-1" })]);

    expect(out.englishAddress).toBeUndefined();
    expect(ncpMock).not.toHaveBeenCalled();
  });

  it("TourAPI 카드(kakao- 아님)는 변환하지 않고 그대로 둔다", async () => {
    hasJuso.mockReturnValue(true);
    hasNcp.mockReturnValue(true);

    const [out] = await enrichEnglishAddresses([place({ id: "tour-1" })]);

    expect(jusoMock).not.toHaveBeenCalled();
    expect(ncpMock).not.toHaveBeenCalled();
    expect(out.englishAddress).toBeUndefined();
  });
});
