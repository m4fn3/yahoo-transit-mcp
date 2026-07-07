import * as cheerio from "cheerio";
import { buildUrl, fetchHtml } from "../fetch.js";
import { extractPageProps, MarkupChangedError } from "../nextData.js";
import type {
  StationCandidate,
  StationDirection,
  TimetableDeparture,
  TimetableResult,
} from "../types.js";

export type DayType = "weekday" | "saturday" | "holiday";
const DAY_TO_KIND: Record<DayType, number> = { weekday: 1, saturday: 2, holiday: 4 };
const DAY_LABEL: Record<DayType, string> = { weekday: "平日", saturday: "土曜", holiday: "日祝" };

/** 駅名 → 駅コード候補。/timetable/search のアンカー（/timetable/{code}）から取る */
export async function resolveStation(query: string): Promise<StationCandidate[]> {
  const html = await fetchHtml(buildUrl("/timetable/search", { q: query }));
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: StationCandidate[] = [];

  $('a[href^="/timetable/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/^\/timetable\/(\d+)/);
    if (!m) return;
    const code = m[1];
    const name = $(el).text().trim();
    if (!name || seen.has(code)) return;
    seen.add(code);
    candidates.push({ name, stationCode: code });
  });

  // 住所情報があれば補完（stationFeatures の並び順は候補と一致するとは限らないため名前で照合）
  try {
    const pageProps = extractPageProps(html);
    const features: any[] = pageProps?.stationFeatures ?? [];
    for (const c of candidates) {
      const f = features.find((f: any) => (f?.Name ?? f?.name) === c.name);
      const addr = f?.Address ?? f?.address;
      if (typeof addr === "string" && addr) c.address = addr;
    }
  } catch {
    // 住所はおまけなので失敗しても無視
  }
  return candidates;
}

/** 駅コード → 路線・方面(groupId)一覧 */
export async function listDirections(stationCode: string): Promise<{
  stationName: string;
  directions: StationDirection[];
}> {
  const html = await fetchHtml(`https://transit.yahoo.co.jp/timetable/${stationCode}`);
  const pageProps = extractPageProps(html);
  const routeInfos: any[] =
    pageProps?.directionDetail?.directionItem?.routeInfos ??
    pageProps?.directionDetail?.routeInfos ??
    [];
  if (routeInfos.length === 0) {
    throw new MarkupChangedError("missing: directionDetail.directionItem.routeInfos");
  }
  const directions: StationDirection[] = [];
  for (const r of routeInfos) {
    const line = r?.railName ?? "?";
    for (const g of r?.railGroup ?? []) {
      directions.push({
        line,
        direction: g?.direction ?? "?",
        groupId: String(g?.groupId ?? ""),
      });
    }
  }
  const stationName =
    pageProps?.stationName ??
    pageProps?.directionDetail?.stationName ??
    pageProps?.directionDetail?.directionItem?.stationName ??
    "";
  return { stationName, directions: directions.filter((d) => d.groupId) };
}

export interface TimetableParams {
  /** 駅名 または 数値の駅コード */
  station: string;
  /** 路線名の部分一致（例: "山手線"） */
  line?: string;
  /** 方面の部分一致（例: "品川"） */
  direction?: string;
  dayType?: DayType;
  hourFrom?: number;
  hourTo?: number;
}

function buildMasterLookup(master: any, key: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of master?.[key] ?? []) {
    const id = item?.id ?? item?.Id;
    const name = item?.name ?? item?.Name;
    if (id !== undefined && name) map.set(String(id), String(name));
  }
  return map;
}

export async function getTimetable(params: TimetableParams): Promise<TimetableResult> {
  const dayType = params.dayType ?? "weekday";

  // 1) 駅コード解決
  let stationCode: string;
  let stationName = params.station;
  if (/^\d+$/.test(params.station.trim())) {
    stationCode = params.station.trim();
  } else {
    const candidates = await resolveStation(params.station);
    const exact = candidates.filter((c) => c.name === params.station);
    const pick = exact.length === 1 ? exact : candidates;
    if (pick.length === 0) {
      throw new Error(`駅「${params.station}」が見つかりませんでした。`);
    }
    if (pick.length > 1) {
      const list = pick
        .slice(0, 10)
        .map((c) => `${c.name} (code:${c.stationCode}${c.address ? `, ${c.address}` : ""})`)
        .join(" / ");
      throw new Error(
        `駅「${params.station}」の候補が複数あります。stationに駅コードを指定してください: ${list}`,
      );
    }
    stationCode = pick[0].stationCode;
    stationName = pick[0].name;
  }

  // 2) 路線・方面の解決
  const { stationName: resolvedName, directions } = await listDirections(stationCode);
  if (resolvedName) stationName = resolvedName;
  let matched = directions;
  if (params.line) matched = matched.filter((d) => d.line.includes(params.line!));
  if (params.direction) matched = matched.filter((d) => d.direction.includes(params.direction!));
  if (matched.length !== 1) {
    const list = directions.map((d) => `${d.line}（${d.direction}）`).join(" / ");
    const head =
      matched.length === 0
        ? `指定の路線・方面が見つかりませんでした。`
        : `路線・方面の候補が複数あります。line / direction で絞り込んでください。`;
    throw new Error(`${head} ${stationName}駅の時刻表: ${list}`);
  }
  const target = matched[0];

  // 3) 時刻表取得
  const html = await fetchHtml(
    buildUrl(`/timetable/${stationCode}/${target.groupId}`, { kind: DAY_TO_KIND[dayType] }),
  );
  const pageProps = extractPageProps(html);
  const item = pageProps?.timetableItem;
  if (!item) throw new MarkupChangedError("missing: timetableItem");

  const kinds = buildMasterLookup(item.master, "kind");
  const destinations = buildMasterLookup(item.master, "destination");

  const departures: TimetableDeparture[] = [];
  for (const hourRow of item.hourTimeTable ?? []) {
    const hour = Number(hourRow?.hour);
    if (params.hourFrom !== undefined && hour < params.hourFrom) continue;
    if (params.hourTo !== undefined && hour > params.hourTo) continue;
    for (const min of hourRow?.minTimeTable ?? []) {
      const dep: TimetableDeparture = {
        time: `${String(hour).padStart(2, "0")}:${String(min?.minute ?? "?").padStart(2, "0")}`,
      };
      const kind = kinds.get(String(min?.kindId));
      if (kind) dep.type = kind;
      const dest = destinations.get(String(min?.destinationId));
      if (dest) dep.destination = dest;
      if (min?.trainName) dep.trainName = min.trainName;
      if (min?.trackNumber) dep.track = `${min.trackNumber}番線`;
      departures.push(dep);
    }
  }

  return {
    station: stationName,
    line: item.railName ?? target.line,
    direction: item.directionName ?? target.direction,
    dayType: DAY_LABEL[dayType],
    departures,
    note: departures.length === 0 ? "指定条件の発車時刻が見つかりませんでした。" : undefined,
  };
}
