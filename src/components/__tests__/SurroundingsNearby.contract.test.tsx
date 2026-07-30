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

import { SurroundingsNearby } from "../SurroundingsNearby";
import { NEARBY_LIMIT_MAX } from "@/lib/nearby-limits";
import { describeNearbyContract } from "./nearby-contract";

const surrounding = {
  id: "kakao-2",
  name: "길동편의점",
  category: "convenience",
  categoryRaw: "가정,생활 > 편의점",
  distanceMeters: 40,
  bearing: "se",
  lat: 37.5386,
  lng: 127.1425,
  phone: "02-333-4444",
  link: "https://place.map.kakao.com/2",
};

describeNearbyContract({
  name: "SurroundingsNearby",
  ns: "surroundingsNearby",
  renderComponent: () => <SurroundingsNearby />,
  triggerName: "surroundingsNearby.button",
  expectedUrl: (lat, lng) =>
    `/api/places/around?lat=${lat}&lng=${lng}&limit=${NEARBY_LIMIT_MAX}`,
  successBody: { places: [surrounding] },
  successProbe: "길동편의점",
  emptyBody: { places: [] },
  hasCoverage: true,
  liveReadyOnDone: true,
});
