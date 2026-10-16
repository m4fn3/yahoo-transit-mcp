import { buildUrl, fetchHtml } from "../fetch.js";
import { extractPageProps, MarkupChangedError, requireKey } from "../nextData.js";
import type { RouteCandidate, RouteLeg, RouteResult } from "../types.js";

export type SearchMode = "departure" | "last_train" | "first_train" | "arrival";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface SearchRouteParams {
  /** 駅名・住所・施設名 */
  from: string;
  to: string;
  /** 出発地の座標。指定するとその地点から歩く経路になる（fromは表示名として使われる） */
  fromLatLon?: LatLon;
  toLatLon?: LatLon;
  via?: string[];
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM */
  time?: string;
  mode?: SearchMode;
  /** ISO 8601日時。この時刻までに着く（mode=arrival + date/time の別表記。タイムゾーン省略時はJST） */
  arriveBy?: string;
  /** ISO 8601日時。この時刻以降に出発（mode=departure + date/time の別表記） */
  departAt?: string;
  /** 返す経路の最大件数（省略時はページにある全件） */
  maxRoutes?: number;
  sort?: "time" | "fare" | "transfers";
  ticket?: "ic" | "normal";
  useShinkansen?: boolean;
  useExpress?: boolean;
  useAirplane?: boolean;
  useHighwayBus?: boolean;
}

// 検証済み: type 1=出発 / 2=終電 / 3=始発 / 4=到着
const MODE_TO_TYPE: Record<SearchMode, number> = {
  departure: 1,
  last_train: 2,
  first_train: 3,
  arrival: 4,
};

const SORT_TO_S: Record<string, number> = { time: 0, fare: 1, transfers: 2 };

function bool01(v: boolean | undefined, def = true): number {
  return (v ?? def) ? 1 : 0;
}

/**
 * timeInfoから発時刻・着時刻を取り出す。
 * 検証結果: type 3=始点の発, 1=途中駅の発, 2=途中駅の着（[着,発]の順で並ぶ）
 */
function pickTimes(timeInfo: any): { dep?: string; arr?: string } {
  if (!Array.isArray(timeInfo) || timeInfo.length === 0) return {};
  const dep = timeInfo.find((t: any) => t?.type === 3 || t?.type === 1)?.time;
  const arr = timeInfo.find((t: any) => t?.type === 2 || t?.type === 4)?.time;
  return {
    dep: dep ?? timeInfo[timeInfo.length - 1]?.time,
    arr: arr ?? timeInfo[0]?.time,
  };
}

/** ridingPositionInfoの ["10","番線"] 形式を "10番線" に。[null,"情報なし"] は不明として扱う */
function joinPlatform(v: any): string | undefined {
  if (Array.isArray(v) && v.length > 0) return v[0] ? v.join("") : undefined;
  if (typeof v === "string" && v) return v;
  return undefined;
}

/** 路線名から移動手段を判定（バスは名前に「バス」を含むかだけで見ている） */
function modeOf(line: string): RouteLeg["mode"] {
  if (/^徒歩/.test(line)) return "walk";
  return /バス/.test(line) ? "bus" : "train";
}

/**
 * 路線名末尾の種別を分ける: "ＪＲ湘南新宿ライン快速" → ["ＪＲ湘南新宿ライン", "快速"]。
 * 「ライナー」は対象外（日暮里・舎人ライナーは路線名）。
 */
export function splitKind(name: string): [string, string | undefined] {
  const m = name.match(
    /^(.+?)((?:通勤|区間|特別|快速|新|準|中央|青梅)?(?:各駅停車|普通|快速|急行|準急|特急|快特|特快))$/,
  );
  return m ? [m[1], m[2]] : [name, undefined];
}

const walkMin = (leg: RouteLeg | undefined): number =>
  leg?.mode === "walk" ? Number(leg.line.match(/^徒歩(\d+)分/)?.[1] ?? 0) : 0;

/**
 * edgeInfoList: 各要素が「駅 + その駅から乗る路線」の一体構造。
 * edge[i](railNameあり) が leg、行き先駅は edge[i+1].stationName。
 * 番線は同一edge内に発・着の両方が入っている。
 */
function parseEdges(edgeInfoList: any[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 0; i < edgeInfoList.length; i++) {
    const edge = edgeInfoList[i];
    const railName: string | undefined = edge?.railName || edge?.railNameExcludingDestination;
    if (!railName) continue; // 路線を持たない要素
    const next = edgeInfoList[i + 1];
    if (!next?.stationName) continue; // 最終着駅ノード（railNameが残っていても行き先がない）
    const line: string = edge.railNameExcludingDestination || railName;
    const mode = modeOf(line);
    const leg: RouteLeg = {
      mode,
      from: edge?.stationName ?? "?",
      fromTime: pickTimes(edge?.timeInfo).dep,
      line,
      destination: edge.destination || undefined,
      to: next?.stationName ?? "?",
      toTime: pickTimes(next?.timeInfo).arr,
    };
    if (mode !== "walk") {
      const [lineName, kind] = splitKind(line);
      leg.lineName = lineName;
      if (kind) leg.kind = kind;
    }
    const pos = edge?.ridingPositionInfo;
    const depPf = joinPlatform(pos?.departure);
    const arrPf = joinPlatform(pos?.arrival);
    if (depPf || arrPf) {
      leg.platform = { departure: depPf, arrival: arrPf };
    }
    const position = Array.isArray(pos?.position) ? pos.position.filter(Boolean).join(" ") : "";
    if (position) leg.position = position;
    const stops = (edge?.stopStationList ?? [])
      .filter((x: any) => x?.name)
      .map((x: any) => ({ name: String(x.name), time: x.departureTime || undefined }));
    if (stops.length > 0) leg.stops = stops;
    const price = edge?.priceInfo?.price;
    if (price) leg.fare = `${price}円`;
    const dia = edge?.diaInfoStatus;
    if (Array.isArray(dia) && dia.length > 0) {
      const msgs = dia
        .map((d: any) => (typeof d === "string" ? d : (d?.message ?? d?.status ?? "")))
        .filter(Boolean);
      if (msgs.length > 0) leg.delayNotice = msgs;
      leg.diaInfoStatus = dia;
    }
    legs.push(leg);
  }
  return legs;
}

/** ISO 8601日時 → JSTの date/time。オフセットがなければJSTとみなす */
function toJst(iso: string): { date: string; time: string } {
  const withTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}+09:00`;
  const t = Date.parse(withTz);
  if (Number.isNaN(t)) throw new Error(`日時を解釈できません: ${iso}（例: 2026-10-20T10:00+09:00）`);
  const j = new Date(t + 9 * 3_600_000).toISOString(); // UTC表記のままJSTの壁時計時刻になる
  return { date: j.slice(0, 10), time: j.slice(11, 16) };
}

/** arriveBy / departAt を mode・date・time に展開する */
function normalize(params: SearchRouteParams): SearchRouteParams {
  if (params.arriveBy && params.departAt) throw new Error("arriveBy と departAt は同時に指定できません。");
  const at = params.arriveBy ?? params.departAt;
  if (!at) return params;
  return { ...params, ...toJst(at), mode: params.arriveBy ? "arrival" : "departure" };
}

export function buildRouteUrl(input: SearchRouteParams): string {
  const params = normalize(input);
  const mode = params.mode ?? "departure";
  const query: Record<string, string | number | undefined> = {
    from: params.from,
    to: params.to,
    type: MODE_TO_TYPE[mode],
    ticket: params.ticket ?? "ic",
    s: SORT_TO_S[params.sort ?? "time"],
    shin: bool01(params.useShinkansen),
    ex: bool01(params.useExpress),
    al: bool01(params.useAirplane),
    hb: bool01(params.useHighwayBus),
    lb: 1,
    sr: 1,
    expkind: 1,
    ws: 3,
  };
  if (params.date) {
    const [y, m, d] = params.date.split("-");
    query.y = y;
    query.m = m;
    query.d = d;
  }
  if (params.time) {
    const [hh, mm] = params.time.split(":");
    query.hh = hh;
    query.m1 = mm[0];
    query.m2 = mm[1];
  }

  // 座標は "lat,lon,表示名"（サイトの検索窓が候補選択時に送るのと同じ形式）
  if (params.fromLatLon) query.flatlon = `${params.fromLatLon.lat},${params.fromLatLon.lon},${params.from}`;
  if (params.toLatLon) query.tlatlon = `${params.toLatLon.lat},${params.toLatLon.lon},${params.to}`;

  const url = new URL(buildUrl("/search/result", query));
  // via は同名パラメータの繰り返し
  for (const v of params.via ?? []) url.searchParams.append("via", v);
  return url.toString();
}

export async function searchRoute(params: SearchRouteParams): Promise<RouteResult> {
  const html = await fetchHtml(buildRouteUrl(params));
  const pageProps = extractPageProps(html);
  const navi = pageProps?.naviSearchParam;
  if (!navi) throw new MarkupChangedError("missing: naviSearchParam");
  // 候補リストは naviSearchParam 直下にない版もあるため pageProps 側も見る
  const otherQueryInfo = navi.otherQueryInfo ?? pageProps?.otherQueryInfo;
  return parseRouteResult({ ...navi, otherQueryInfo }, params);
}

/** pageProps.naviSearchParam → RouteResult */
export function parseRouteResult(navi: any, input: SearchRouteParams): RouteResult {
  const params = normalize(input);
  const mode = params.mode ?? "departure";
  const result: RouteResult = {
    query: { from: params.from, to: params.to, date: params.date, time: params.time, mode },
    routes: [],
  };

  const features: any[] = navi.featureInfoList ?? [];
  if (features.length === 0) {
    const other = navi.otherQueryInfo;
    const fromList = (other?.fromList ?? []).map((x: any) => x?.name ?? x).filter(Boolean);
    const toList = (other?.toList ?? []).map((x: any) => x?.name ?? x).filter(Boolean);
    if (fromList.length > 0 || toList.length > 0) {
      result.didYouMean = {
        from: fromList.length > 0 ? fromList.slice(0, 10) : undefined,
        to: toList.length > 0 ? toList.slice(0, 10) : undefined,
      };
      result.note = "駅名が曖昧です。候補から選んで再検索してください。";
    } else {
      result.note = "経路が見つかりませんでした。駅名・日時を確認してください。";
    }
    return result;
  }

  const limited = params.maxRoutes ? features.slice(0, params.maxRoutes) : features;
  result.routes = limited.map((f: any, i: number): RouteCandidate => {
    const s = requireKey<any>(f, "summaryInfo");
    const badges: string[] = [];
    if (s.isFast) badges.push("早");
    if (s.isEasy) badges.push("楽");
    if (s.isCheap) badges.push("安");
    const legs = parseEdges(f.edgeInfoList ?? []);
    return {
      no: i + 1,
      depart: s.departureTime ?? "?",
      arrive: s.arrivalTime ?? "?",
      duration: s.totalTime ?? "?",
      fare: s.totalPrice ? `${s.totalPrice}円` : undefined,
      transfers: typeof s.transferCount === "number" ? s.transferCount : Number(s.transferCount ?? -1),
      distance: s.distance || undefined,
      walkStartMin: walkMin(legs[0]),
      walkEndMin: legs.length > 1 ? walkMin(legs[legs.length - 1]) : 0,
      badges,
      legs,
    };
  });
  return result;
}
