"""E70 택시 출구 실측: 역별 출구·택시승강장 수집 + 출구마다 목적지까지 Tmap 자동차 경로.

사용: python3 -I scripts/probe-taxi-exit.py OUT.json   (env KAKAO_REST_API_KEY, TMAP_APP_KEY)
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request

KAKAO = os.environ["KAKAO_REST_API_KEY"]
TMAP = os.environ["TMAP_APP_KEY"]

# (역 이름, 목적지 검색어) — 위원장 실사용 여정 + 큰 환승역 표본
CASES = [
    ("역곡", "부천시청"),
    ("노량진", "천호역"),
    ("강동", "광화문"),
    ("중앙보훈병원", "강동구청"),
    ("대방", "여의도 IFC몰"),
    ("개봉", "구로구청"),
    ("강남", "코엑스"),
    ("서울", "서울대학교병원"),
    ("잠실", "올림픽공원"),
    ("수원", "수원시청"),
]


def get(url, params, headers):
    q = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{q}", headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def kakao_kw(query, **kw):
    p = {"query": query, "size": 15, **kw}
    return get("https://dapi.kakao.com/v2/local/search/keyword.json", p,
               {"Authorization": f"KakaoAK {KAKAO}"})["documents"]


def hav(a, b):
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def tmap_car(o, d):
    body = json.dumps({"startX": str(o[1]), "startY": str(o[0]), "endX": str(d[1]), "endY": str(d[0]),
                       "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO"}).encode()
    req = urllib.request.Request("https://apis.openapi.sk.com/tmap/routes?version=1", data=body,
                                 headers={"appKey": TMAP, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            txt = r.read().decode("utf-8", "replace").replace("\x00", " ")
        props = json.loads(txt)["features"][0]["properties"]
        return {"m": props.get("totalDistance"), "s": props.get("totalTime"), "fare": props.get("taxiFare")}
    except Exception as e:  # 호출 단위 실패 격리
        return {"error": str(e)[:120]}


def exit_label(name):
    m = re.search(r"(\d+(?:-\d+)?)번\s*출구", name)
    return m.group(1) if m else None


def probe(station, dest_q):
    st = [x for x in kakao_kw(f"{station}역") if "지하철,전철" in x["category_name"] and "출구" not in x["category_name"]]
    if not st:
        return {"station": station, "error": "역 미발견"}
    s = st[0]
    sc = (float(s["y"]), float(s["x"]))
    dd = kakao_kw(dest_q)[0]
    dc = (float(dd["y"]), float(dd["x"]))

    exits, misses, n = {}, 0, 1
    # 방법 A: 번호별 검색(번호가 끊겨도 3개 연속 미발견까지 계속)
    while misses < 3 and n <= 25:
        hit = False
        for x in kakao_kw(f"{station}역 {n}번출구", y=sc[0], x=sc[1], radius=800):
            if x["category_name"].endswith("지하철출구") and x["place_name"].startswith(f"{station}역"):
                exits[x["id"]] = x
                if exit_label(x["place_name"]) and exit_label(x["place_name"]).split("-")[0] == str(n):
                    hit = True
        misses = 0 if hit else misses + 1
        n += 1
    # 방법 B: "출구" 한 번 검색(좌표 반경) — A와 비교용
    b_ids = set()
    for page in (1, 2, 3):
        docs = kakao_kw(f"{station}역 출구", y=sc[0], x=sc[1], radius=800, page=page)
        for x in docs:
            if x["category_name"].endswith("지하철출구") and x["place_name"].startswith(f"{station}역"):
                b_ids.add(x["id"])
                exits.setdefault(x["id"], x)
        if len(docs) < 15:
            break

    stands = {}
    for q in ("택시승강장", f"{station}역 택시승강장", f"{station}역 택시"):
        for x in kakao_kw(q, y=sc[0], x=sc[1], radius=500):
            if "택시" in x["place_name"] and ("승강장" in x["place_name"] or x["category_name"].endswith("택시")):
                if hav(sc, (float(x["y"]), float(x["x"]))) <= 500:
                    stands[x["id"]] = x

    rows = []
    for x in sorted(exits.values(), key=lambda v: v["place_name"]):
        ec = (float(x["y"]), float(x["x"]))
        r = tmap_car(ec, dc)
        time.sleep(0.15)
        rows.append({"name": x["place_name"], "label": exit_label(x["place_name"]),
                     "fromStationM": round(hav(sc, ec)), "lat": ec[0], "lng": ec[1],
                     "nearestStandM": min((round(hav(ec, (float(t["y"]), float(t["x"])))) for t in stands.values()), default=None),
                     "car": r})
    base = tmap_car(sc, dc)
    return {"station": station, "stationName": s["place_name"], "dest": dd["place_name"],
            "destM": round(hav(sc, dc)), "exitsA": len(exits) - len(b_ids - set(exits)),
            "exitsBonly": len(b_ids), "exits": rows,
            "stands": [{"name": t["place_name"], "cat": t["category_name"],
                        "fromStationM": round(hav(sc, (float(t["y"]), float(t["x"]))))} for t in stands.values()],
            "fromStationCenter": base}


def main():
    out = [probe(s, d) for s, d in CASES]
    json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
