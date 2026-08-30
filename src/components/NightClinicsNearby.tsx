"use client";

import { KoTail, langFor, useBilingualName } from "@/components/BilingualName";
import { useTranslations } from "next-intl";
import type { ClinicOpenStatus, NightClinic } from "@/lib/types";
import { formatDistance, joinText } from "@/lib/format";
import { useNearbyFetch } from "@/hooks/useNearbyFetch";
import { useRevealMore } from "@/hooks/useRevealMore";
import { NearbyPanelShell } from "@/components/NearbyPanelShell";
import { nearbyLiveMessage } from "@/lib/nearby-live";

/** API 응답 항목 — NightClinic + 서버 계산 진료 상태. */
type ClinicWithStatus = NightClinic & { openStatus: ClinicOpenStatus };

/** 진료시간 판정 축 — 어느 기준으로 읽었는지 UI가 밝힌다. */
type HoursBasis = "holiday" | "weekday";

/** done 데이터 — 목록 + 판정 기준 + 보완 소스 실패 여부(은폐 금지). */
interface ClinicsData {
  clinics: ClinicWithStatus[];
  basis: HoursBasis;
  supplementFailed: boolean;
}

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
  const bilingual = useBilingualName();
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const { status, doneSeq, load, close, busy, headingRef, triggerRef } =
    useNearbyFetch<ClinicsData>({
      source: { kind: "current" },
      fetchAt: ({ lat, lng }) =>
        fetch(`/api/clinic/nearby?lat=${lat}&lng=${lng}`, { cache: "no-store" }),
      parse: (body) => {
        const b = body as {
          clinics?: ClinicWithStatus[];
          basis?: string;
          supplementFailed?: boolean;
        };
        const clinics = b.clinics ?? [];
        if (clinics.length === 0) return { kind: "empty" };
        return {
          kind: "done",
          data: {
            clinics,
            basis: b.basis === "holiday" ? "holiday" : "weekday",
            supplementFailed: b.supplementFailed === true,
          },
        };
      },
    });
  const { visibleCount, reveal, itemHeadingRefs } = useRevealMore(doneSeq);
  const live = nearbyLiveMessage(status, t, tCommon);

  return (
    <NearbyPanelShell
      triggerLabel={status.kind === "done" ? t("refresh") : t("button")}
      onTrigger={() => load(status.kind === "done")}
      triggerRef={triggerRef}
      busy={busy}
      live={live}
      open={status.kind === "done"}
      heading={status.kind === "done" ? `${t("ready")} ${t("asOf", { time: status.at })}` : ""}
      headingRef={headingRef}
      notice={
        status.kind === "done" && (
          <>
            {/* 공휴일 기준으로 읽은 날만 밝힌다 — 요일 기준 표기는 무정보 잡음
                (항목의 "오늘 진료 X~Y"가 이미 행동 가능한 전부, 위원장 판정 2026-07-26). */}
            {status.data.basis === "holiday" && (
              <p className="mt-1 text-sm">{t("basisHoliday")}</p>
            )}

            {/* 보완 소스 실패는 표기 — 결과가 적은 이유를 숨기지 않는다(조건부라 잡음 아님). */}
            {status.data.supplementFailed && (
              <p className="mt-1 text-sm">{t("supplementFailedNotice")}</p>
            )}
          </>
        )
      }
      onClose={() => close()}
      closeLabel={tActions("close")}
      source={t("source")}
    >
      {status.kind === "done" && (
        <>
          <ul className="mt-2 space-y-4">
            {status.data.clinics.slice(0, visibleCount).map((c, i) => {
              const holiday = c.hours[7];
              const name = bilingual(c.name, { roman: c.nameRoman });
              const line = joinText(
                name.primary,
                c.kind,
                t("distance", { distance: formatDistance(c.distanceMeters) }),
              );
              return (
                <li key={c.id || `${c.name}-${c.distanceMeters}`}>
                  {/* 한 줄 = 한 객체: 이름·분류(한국어)·거리를 단일 텍스트로 합친다. 비-ko는 이름이
                      로마자이고 한글은 줄 끝 괄호(E28 R1 — 가운데 두면 텍스트 노드가 갈린다).
                      lang은 접근 텍스트에 한글이 남을 때만(분류는 아직 한국어라 대개 남는다). */}
                  <h4
                    className="font-medium"
                    lang={langFor(line)}
                    tabIndex={-1}
                    ref={(el) => {
                      itemHeadingRefs.current[i] = el;
                    }}
                  >
                    {line}
                    <KoTail secondary={name.secondary} />
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
                  {status.data.basis === "weekday" &&
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
                        aria-label={t("callAction", { name: name.primary })}
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
          {status.data.clinics.length > visibleCount && (
            <button
              type="button"
              onClick={reveal}
              className="mt-2 min-h-11 text-sm text-accent underline"
            >
              {tActions("showMore")}
            </button>
          )}
        </>
      )}
    </NearbyPanelShell>
  );
}
