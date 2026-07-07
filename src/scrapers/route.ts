import { buildUrl, fetchHtml } from "../fetch.js";
import { extractPageProps, MarkupChangedError, requireKey } from "../nextData.js";
import type { RouteCandidate, RouteLeg, RouteResult } from "../types.js";

export type SearchMode = "departure" | "last_train" | "first_train" | "arrival";

export interface SearchRouteParams {
  from: string;
  to: string;
  via?: string[];
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM */
  time?: string;
  mode?: SearchMode;
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

/** ridingPositionInfoの ["10","番線"] 形式を "10番線" に */
function joinPlatform(v: any): string | undefined {
  if (Array.isArray(v) && v.length > 0) return v.join("");
  if (typeof v === "string" && v) return v;
  return undefined;
}

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
    const leg: RouteLeg = {
      from: edge?.stationName ?? "?",
      fromTime: pickTimes(edge?.timeInfo).dep,
      line: edge.railNameExcludingDestination || railName,
      destination: edge.destination || undefined,
      to: next?.stationName ?? "?",
      toTime: pickTimes(next?.timeInfo).arr,
    };
    const pos = edge?.ridingPositionInfo;
    const depPf = joinPlatform(pos?.departure);
    const arrPf = joinPlatform(pos?.arrival);
    if (depPf || arrPf) {
      leg.platform = { departure: depPf, arrival: arrPf };
    }
    const price = edge?.priceInfo?.price;
    if (price) leg.fare = `${price}円`;
    const dia = edge?.diaInfoStatus;
    if (Array.isArray(dia) && dia.length > 0) {
      const msgs = dia
        .map((d: any) => (typeof d === "string" ? d : (d?.message ?? d?.status ?? "")))
        .filter(Boolean);
      if (msgs.length > 0) leg.delayNotice = msgs;
    }
    legs.push(leg);
  }
  return legs;
}

export async function searchRoute(params: SearchRouteParams): Promise<RouteResult> {
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

  const url = new URL(buildUrl("/search/result", query));
  // via は同名パラメータの繰り返し
  for (const v of params.via ?? []) url.searchParams.append("via", v);

  const html = await fetchHtml(url.toString());
  const pageProps = extractPageProps(html);
  const navi = pageProps?.naviSearchParam;
  if (!navi) throw new MarkupChangedError("missing: naviSearchParam");

  const result: RouteResult = {
    query: { from: params.from, to: params.to, date: params.date, time: params.time, mode },
    routes: [],
  };

  const features: any[] = navi.featureInfoList ?? [];
  if (features.length === 0) {
    const other = navi.otherQueryInfo ?? pageProps?.otherQueryInfo;
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

  result.routes = features.map((f: any, i: number): RouteCandidate => {
    const s = requireKey<any>(f, "summaryInfo");
    const badges: string[] = [];
    if (s.isFast) badges.push("早");
    if (s.isEasy) badges.push("楽");
    if (s.isCheap) badges.push("安");
    return {
      no: i + 1,
      depart: s.departureTime ?? "?",
      arrive: s.arrivalTime ?? "?",
      duration: s.totalTime ?? "?",
      fare: s.totalPrice ? `${s.totalPrice}円` : undefined,
      transfers: typeof s.transferCount === "number" ? s.transferCount : Number(s.transferCount ?? -1),
      distance: s.distance || undefined,
      badges,
      legs: parseEdges(f.edgeInfoList ?? []),
    };
  });
  return result;
}
