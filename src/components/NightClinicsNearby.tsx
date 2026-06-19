"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ClinicOpenStatus, NightClinic } from "@/lib/types";
import { formatDistance } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";

/** API 응답 항목 — NightClinic + 서버 계산 진료 상태. */
type ClinicWithStatus = NightClinic & { openStatus: ClinicOpenStatus };

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "done"; clinics: ClinicWithStatus[]; at: string };

/** HHMM 정수(1800, 2400) → "18:00"/"24:00". null/비정상은 빈 문자열. */
function formatTime(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = String(Math.trunc(n)).padStart(4, "0");
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

/**
 * 내 주변 소아 야간·휴일 진료(달빛어린이병원·소아전문센터, B1) — 홈 진입점.
 *
 * 따릉이/지하철 nearby(mode current)와 동형: 버튼 → geolocation → 좌표 조회.
 * 의료 안전망이라 가짜 데이터 없음(키 없으면 섹션 자체가 미노출). 진료 상태는
 * open/closed/unknown 3-state로 "마감"과 "정보 없음"을 구분(시각장애인 정합).
 * 전화는 tel: 링크로 바로 연결(야간 응급 시 1탭 통화).
 */
export function NightClinicsNearby() {
  const t = useTranslations("clinicNearby");
  const tActions = useTranslations("actions");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/clinic/nearby?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error" });
        return;
      }
      const clinics = (body.clinics ?? []) as ClinicWithStatus[];
      if (clinics.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      const at = new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus({ kind: "done", clinics, at });
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(매 버튼마다 getCurrentPosition을 부르지 않음).
    void awaitGeolocation().then((g) => {
      if (g.status === "ready") {
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        setStatus({
          kind: "geoerror",
          reason: g.status === "unsupported" ? "unsupported" : "denied",
        });
        done();
      }
    });
  }

  // 펼친 결과를 다시 감춘다(idle 복귀). 포커스를 트리거 버튼으로 되돌린다.
  function close() {
    setStatus({ kind: "idle" });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const busy = status.kind === "locating" || status.kind === "loading";
  const buttonLabel = status.kind === "done" ? t("refresh") : t("button");

  const live =
    status.kind === "locating"
      ? t("locating")
      : status.kind === "loading"
        ? t("loading")
        : status.kind === "empty"
          ? t("empty")
          : status.kind === "error"
            ? t("error")
            : status.kind === "geoerror"
              ? status.reason === "denied"
                ? t("geoDenied")
                : t("geoUnsupported")
              : status.kind === "done"
                ? t("ready")
                : "";

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={load}
        aria-disabled={busy}
        aria-busy={busy}
        className="min-h-11 rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent aria-disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-sm">
        {live}
      </p>

      {status.kind === "done" && (
        <section
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("ready")}
            <span className="ml-2 text-xs font-normal opacity-70">
              {t("asOf", { time: status.at })}
            </span>
          </h3>

          <button
            type="button"
            onClick={close}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <ul className="mt-2 space-y-4">
            {status.clinics.map((c) => {
              const holiday = c.hours[7];
              return (
                <li key={c.id || `${c.name}-${c.distanceMeters}`}>
                  <p className="font-medium">
                    <span lang="ko">{c.name}</span>{" "}
                    <span className="text-xs font-normal opacity-70">
                      {c.kind && <span lang="ko">{c.kind} · </span>}
                      {t("distance", { distance: formatDistance(c.distanceMeters) })}
                    </span>
                  </p>

                  {/* 진료 상태 3-state — 마감과 정보없음을 구분 */}
                  <p className="mt-1 text-sm">
                    {c.openStatus.state === "open"
                      ? t("open")
                      : c.openStatus.state === "closed"
                        ? t("closed")
                        : t("unknown")}
                    {c.openStatus.start != null && c.openStatus.end != null && (
                      <span className="ml-1 opacity-70">
                        ({t("todayHours", {
                          start: formatTime(c.openStatus.start),
                          end: formatTime(c.openStatus.end),
                        })})
                      </span>
                    )}
                  </p>

                  {holiday && holiday.start != null && holiday.end != null && (
                    <p className="text-sm opacity-70">
                      {t("holidayHours", {
                        start: formatTime(holiday.start),
                        end: formatTime(holiday.end),
                      })}
                    </p>
                  )}

                  {c.phone && (
                    <p className="mt-1 text-sm">
                      <a
                        href={`tel:${c.phone}`}
                        className="text-accent underline"
                        aria-label={t("callAction", { name: c.name })}
                      >
                        {c.phone}
                      </a>
                    </p>
                  )}

                  <p className="mt-1 text-sm" lang="ko">
                    {c.address}
                  </p>

                  {c.directions && (
                    <p className="text-xs opacity-70" lang="ko">
                      {t("directions", { text: c.directions })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </section>
      )}
    </div>
  );
}
