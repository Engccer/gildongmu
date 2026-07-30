"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ClinicOpenStatus, NightClinic } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { awaitGeolocation } from "@/lib/geolocation";
import { isInKorea } from "@/lib/coverage";
import { isOutOfCoverageBody } from "@/lib/out-of-coverage";
import { useNearbyPanel } from "@/hooks/useNearbyPanel";

/** API 응답 항목 — NightClinic + 서버 계산 진료 상태. */
type ClinicWithStatus = NightClinic & { openStatus: ClinicOpenStatus };

/** 진료시간 판정 축 — 어느 기준으로 읽었는지 UI가 밝힌다. */
type HoursBasis = "holiday" | "weekday";

type Status =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "geoerror"; reason: "denied" | "unsupported" }
  | { kind: "outOfCoverage" }
  | {
      kind: "done";
      clinics: ClinicWithStatus[];
      at: string;
      basis: HoursBasis;
      /** 보완 소스 실패 — 지정 기관만 표시 중임을 밝힌다(은폐 금지). */
      supplementFailed: boolean;
    };

/** HHMM 정수(1800, 2400) → "18:00"/"24:00". null/비정상은 빈 문자열. */
function formatTime(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = String(Math.trunc(n)).padStart(4, "0");
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

/** 초기 표시 수·"더 보기" 1회 공개 수 — iOS ClinicNearbyModel과 동일 값 유지. */
const INITIAL_VISIBLE = 10;
const REVEAL_STEP = 10;

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
  const tCommon = useTranslations("common");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlightRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** done 진입 시 헤딩 포커스를 1회만 옮기기 위한 가드(재조회 시 재발화). */
  const focusedRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  /** 공개된 항목 헤딩 참조 — "더 보기" 후 첫 새 항목으로 포커스 이동(헌장 §1). */
  const itemHeadingRefs = useRef<(HTMLHeadingElement | null)[]>([]);
  const pendingFocusIndex = useRef<number | null>(null);

  async function fetchAt(lat: number, lng: number) {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`/api/clinic/nearby?lat=${lat}&lng=${lng}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (isOutOfCoverageBody(body)) {
        setStatus({ kind: "outOfCoverage" });
        return;
      }
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
      setVisibleCount(INITIAL_VISIBLE);
      setStatus({
        kind: "done",
        clinics,
        at,
        basis: body.basis === "holiday" ? "holiday" : "weekday",
        supplementFailed: body.supplementFailed === true,
      });
    } catch {
      setStatus({ kind: "error" });
    }
  }

  function load(force = false) {
    const prevStatus = status;
    claim();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const done = () => {
      inFlightRef.current = false;
    };
    setStatus({ kind: "locating" });
    // 공유 스토어에서 좌표를 얻는다 — 세션 1회 권한 획득 뒤로는 캐시 좌표를
    // 팝업 없이 재사용한다(매 버튼마다 getCurrentPosition을 부르지 않음).
    void awaitGeolocation({ force }).then((g) => {
      if (g.status === "ready") {
        if (!isInKorea(g.coords.lat, g.coords.lng)) {
          setStatus({ kind: "outOfCoverage" });
          done();
          return;
        }
        void fetchAt(g.coords.lat, g.coords.lng).finally(done);
      } else {
        // 새로고침(force) 실패 시 보던 데이터를 잃지 않는다 — done이면 직전 결과를
        // 복원하고, 첫 조회 실패면 geoerror. 실내 등에서 정밀 재취득(GPS)이 자주
        // 실패할 수 있어 데이터 소멸을 막는다.
        setStatus(
          prevStatus.kind === "done"
            ? prevStatus
            : {
                kind: "geoerror",
                reason: g.status === "unsupported" ? "unsupported" : "denied",
              },
        );
        done();
      }
    });
  }

  // 펼친 결과를 다시 감춘다(idle 복귀). restoreFocus면 포커스를 트리거 버튼으로
  // 되돌린다(직접 닫기·Esc). 다른 패널이 점유를 가져가 자동으로 닫힐 때는
  // restoreFocus=false로 포커스를 옮기지 않는다.
  const close = useCallback((restoreFocus = true) => {
    setStatus({ kind: "idle" });
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const onDismiss = useCallback(() => close(false), [close]);
  const onEscape = useCallback(() => close(true), [close]);
  const { claim } = useNearbyPanel({
    engaged: status.kind !== "idle",
    onDismiss,
    onEscape,
  });

  // done 진입 시 결과 헤딩으로 포커스 이동(접근성 1급). fetch 완료 직후 rAF로
  // 옮기면 React 커밋과 인과관계가 없어 레이스가 생긴다(헤딩이 아직 DOM에
  // 없을 수 있음) — useEffect는 커밋 이후 실행이 보장되므로 안전하다
  // (PlaceDetail·PlaceSearch의 결과 헤딩 포커스와 동형).
  useEffect(() => {
    if (status.kind === "done") {
      if (!focusedRef.current) {
        focusedRef.current = true;
        headingRef.current?.focus();
      }
    } else {
      focusedRef.current = false;
    }
  }, [status.kind]);

  // "더 보기"로 공개된 첫 새 항목으로 포커스 이동 — 새 항목의 라벨이 곧 통지라
  // 별도 live region은 두지 않는다(중복 낭독). useLayoutEffect로 페인트 전에
  // 동기 실행한다 — 마지막 배치를 공개하는 클릭은 포커스를 쥔 "더 보기" 버튼이
  // 같은 커밋에서 unmount되므로, 커밋·페인트 이후 실행되는 useEffect라면
  // 재포커스 전까지 짧은 body 이탈 창이 생긴다(헌장 §5). useLayoutEffect는
  // 그 배치가 화면에 그려지기 전에 새 항목으로 재포커스해 이탈 창을 없앤다.
  useLayoutEffect(() => {
    const i = pendingFocusIndex.current;
    if (i == null) return;
    pendingFocusIndex.current = null;
    itemHeadingRefs.current[i]?.focus();
  }, [visibleCount]);

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
              : status.kind === "outOfCoverage"
                ? tCommon("outOfCoverage")
                : status.kind === "done"
                  ? t("ready")
                  : "";

  return (
    <div className="mt-3">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => load(status.kind === "done")}
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
        <div
          className="mt-2 rounded-md border border-border p-3"
        >
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {`${t("ready")} ${t("asOf", { time: status.at })}`}
          </h3>

          {/* 공휴일 기준으로 읽은 날만 밝힌다 — 요일 기준 표기는 무정보 잡음
              (항목의 "오늘 진료 X~Y"가 이미 행동 가능한 전부, 위원장 판정 2026-07-26). */}
          {status.basis === "holiday" && (
            <p className="mt-1 text-sm">{t("basisHoliday")}</p>
          )}

          {/* 보완 소스 실패는 표기 — 결과가 적은 이유를 숨기지 않는다(조건부라 잡음 아님). */}
          {status.supplementFailed && (
            <p className="mt-1 text-sm">{t("supplementFailedNotice")}</p>
          )}

          <button
            type="button"
            onClick={() => close()}
            className="mt-1 min-h-11 text-sm text-accent underline"
          >
            {tActions("close")}
          </button>

          <ul className="mt-2 space-y-4">
            {status.clinics.slice(0, visibleCount).map((c, i) => {
              const holiday = c.hours[7];
              return (
                <li key={c.id || `${c.name}-${c.distanceMeters}`}>
                  {/* 한 줄 = 한 객체: 이름·분류(한국어)·거리를 단일 텍스트로 합친다.
                      이름·분류가 한국어 전용 데이터라 lang="ko"를 줄 전체로 옮긴다. */}
                  <h4
                    className="font-medium"
                    lang="ko"
                    tabIndex={-1}
                    ref={(el) => {
                      itemHeadingRefs.current[i] = el;
                    }}
                  >
                    {joinText(
                      c.name,
                      c.kind,
                      t("distance", { distance: formatDistance(c.distanceMeters) }),
                    )}
                  </h4>

                  {/* 진료 상태 3-state — 마감과 정보없음을 구분(분기 유지, 부가 운영시간만 흡수).
                      달빛 지정 여부는 목록 미표기(위원장 판정 2026-07-26): 지정의 행동 가능한
                      결과(늦은 진료시간·지금 열림·기관명)가 이미 항목에 전부 보인다 — 데이터
                      designated는 보존, 상세 이식 시 조건부 노출. */}
                  <p className="mt-1 text-sm">
                    {joinText(
                      c.openStatus.state === "open"
                        ? t("open")
                        : c.openStatus.state === "closed"
                          ? t("closed")
                          : t("unknown"),
                      c.openStatus.start != null &&
                        c.openStatus.end != null &&
                        t("todayHours", {
                          start: formatTime(c.openStatus.start),
                          end: formatTime(c.openStatus.end),
                        }),
                    )}
                  </p>

                  {/* 공휴일 기준으로 판정한 날엔 위 "오늘 진료"가 곧 공휴일 진료시간이라
                      같은 값을 두 번 낭독하게 된다 — 요일 기준일 때만 부가 표시. */}
                  {status.basis === "weekday" &&
                    holiday &&
                    holiday.start != null &&
                    holiday.end != null && (
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
          {status.clinics.length > visibleCount && (
            <button
              type="button"
              onClick={() => {
                pendingFocusIndex.current = visibleCount;
                setVisibleCount((v) => v + REVEAL_STEP);
              }}
              className="mt-2 min-h-11 text-sm text-accent underline"
            >
              {tActions("showMore")}
            </button>
          )}
          <p className="mt-2 text-xs opacity-70">{t("source")}</p>
        </div>
      )}
    </div>
  );
}
