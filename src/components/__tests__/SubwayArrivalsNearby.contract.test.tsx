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

import { SubwayArrivalsNearby } from "../SubwayArrivalsNearby";
import { describeNearbyContract } from "./nearby-contract";

const station = {
  stationName: "굽은다리",
  nameEn: "Gubeundari",
  lines: ["5호선"],
  distanceMeters: 240,
  arrivalStatus: "ok",
  arrivals: [
    {
      line: "5호선",
      direction: "상행",
      trainLineNm: "방화행 - 강동방면",
      destination: "방화",
      message: "3분 후(2번째 전)",
      currentLocation: "명일",
      arrivalSeconds: 180,
      express: false,
    },
  ],
};

describeNearbyContract({
  name: "SubwayArrivalsNearby",
  ns: "subwayNearby",
  renderComponent: () => <SubwayArrivalsNearby />,
  triggerName: "subwayNearby.button",
  expectedUrl: (lat, lng) =>
    `/api/station/subway-arrival/nearby?lat=${lat}&lng=${lng}`,
  successBody: { stations: [station] },
  successProbe: "굽은다리",
  emptyBody: { stations: [] },
  hasCoverage: true,
  liveReadyOnDone: true,
});
