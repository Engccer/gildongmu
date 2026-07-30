// @vitest-environment jsdom
import { vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => {
    const f = (key: string, params?: Record<string, unknown>) =>
      params ? `${ns}.${key}${JSON.stringify(params)}` : `${ns}.${key}`;
    return Object.assign(f, { rich: (key: string) => `${ns}.${key}` });
  },
  useLocale: () => "ko",
}));
vi.mock("@/lib/geolocation", () => ({ awaitGeolocation: vi.fn() }));

import { KidsPlacesNearby } from "../KidsPlacesNearby";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { describeNearbyContract } from "./nearby-contract";

const kidsPlace = {
  id: "kakao-1",
  name: "길동키즈카페",
  category: "가정,생활 > 유아용품 > 키즈카페",
  kind: "kidscafe",
  indoorOutdoor: "indoor",
  distanceMeters: 120,
  address: "서울 강동구 길동 1",
  roadAddress: "서울 강동구 양재대로 1",
  lat: 37.5385,
  lng: 127.1424,
  phone: "02-111-2222",
  link: "https://place.map.kakao.com/1",
};

describeNearbyContract({
  name: "KidsPlacesNearby",
  ns: "kidsNearby",
  renderComponent: () => <KidsPlacesNearby />,
  triggerName: "kidsNearby.button",
  expectedUrl: (lat, lng) =>
    `/api/places/kids?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
  successBody: { kids: [kidsPlace] },
  successProbe: "길동키즈카페",
  emptyBody: { kids: [] },
  hasCoverage: true,
  liveReadyOnDone: true,
});
