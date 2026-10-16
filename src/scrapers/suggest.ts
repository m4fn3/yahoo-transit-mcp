import { buildUrl, fetchHtml } from "../fetch.js";
import { MarkupChangedError } from "../nextData.js";
import type { PlaceCandidate } from "../types.js";

// サイトの検索窓の入力補完が使う非公開エンドポイント（/api/suggest）。仕様は公開されておらず、予告なく変わり得る
const KINDS: Record<string, PlaceCandidate["kind"]> = { st: "station", bu: "bus", la: "facility" };

/** /api/suggest のJSON → 候補。住所そのものは候補に出ない（search_route に住所を直接渡せばよい） */
export function parseSuggest(body: any): PlaceCandidate[] {
  if (!Array.isArray(body?.Result)) throw new MarkupChangedError("missing: suggest Result");
  return body.Result.filter((r: any) => KINDS[r?.Id] && r.Suggest).map((r: any) => {
    const c: PlaceCandidate = { name: String(r.Suggest), kind: KINDS[r.Id] };
    if (r.Code || r.Gid) c.id = String(r.Code || r.Gid);
    if (r.Id === "la" && r.Address) c.address = String(r.Address); // 駅・バス停の Address は都道府県名程度
    if (r.Lat && r.Lon) {
      c.lat = Number(r.Lat);
      c.lon = Number(r.Lon);
    }
    return c;
  });
}

export async function suggestPlace(query: string): Promise<PlaceCandidate[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const body = await fetchHtml(buildUrl("/api/suggest", { value: q }));
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new MarkupChangedError("suggest のJSONを解析できません");
  }
  return parseSuggest(json);
}
