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

import { NightClinicsNearby } from "../NightClinicsNearby";
import { describeNearbyContract } from "./nearby-contract";

/** NightClinic + 라우트가 덧붙이는 openStatus(진료 3-state). */
const clinic = {
  id: "clinic-1",
  name: "서울아이병원",
  address: "서울 강동구 천호대로 1000",
  phone: "02-1234-5678",
  kind: "달빛어린이병원",
  emergencyClass: "응급의료기관 이외",
  directions: "",
  lat: 37.5385,
  lng: 127.1234,
  distanceMeters: 350,
  hours: [],
  openStatus: { state: "open", start: 1800, end: 2400 },
  designated: true,
};

describeNearbyContract({
  name: "NightClinicsNearby",
  ns: "clinicNearby",
  renderComponent: () => <NightClinicsNearby />,
  triggerName: "clinicNearby.button",
  expectedUrl: (lat, lng) => `/api/clinic/nearby?lat=${lat}&lng=${lng}`,
  successBody: { clinics: [clinic], basis: "weekday", supplementFailed: false },
  successProbe: "서울아이병원",
  emptyBody: { clinics: [], basis: "weekday", supplementFailed: false },
  hasCoverage: true,
  liveReadyOnDone: true,
});
