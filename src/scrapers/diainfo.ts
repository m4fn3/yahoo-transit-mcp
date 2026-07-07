import { fetchHtml } from "../fetch.js";
import { extractPageProps, MarkupChangedError } from "../nextData.js";
import type { DiainfoResult, LineStatus } from "../types.js";

export const AREA_IDS: Record<string, number> = {
  北海道: 2,
  東北: 3,
  関東: 4,
  中部: 5,
  近畿: 6,
  九州: 7,
  中国: 8,
  四国: 9,
};

export interface DiainfoParams {
  area?: keyof typeof AREA_IDS | string;
  onlyTroubled?: boolean;
  /** 路線名の部分一致フィルタ（例: "山手線"） */
  line?: string;
}

function toLineStatus(rail: any): LineStatus {
  const prop = rail?.routeInfo?.property ?? rail?.property ?? {};
  // 検証結果: diainfo は property の下にネストしている
  const dia = (prop.diainfo ?? rail?.routeInfo?.diainfo ?? rail?.diainfo ?? [])[0] ?? {};
  const status = [dia.status, dia.statusSup1].filter(Boolean).join("・");
  return {
    line: prop.displayName ?? prop.railName ?? "?",
    company: prop.companyName || undefined,
    status: status || "情報あり",
    message: dia.message || undefined,
    updatedAt: dia.updateDate || undefined,
  };
}

/** diainfoTrainFeatures（全路線・事業者グループのネスト）から路線名を平坦に取り出す */
function collectAllLineNames(groups: any): string[] {
  const names: string[] = [];
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const prop = node.routeInfo?.property ?? node.property;
    const name = prop?.displayName ?? prop?.railName;
    if (typeof name === "string" && name) names.push(name);
    for (const v of Object.values(node)) {
      if (typeof v === "object") visit(v);
    }
  };
  visit(groups);
  return [...new Set(names)];
}

export async function getTrainStatus(params: DiainfoParams = {}): Promise<DiainfoResult> {
  const areaName = params.area ?? "関東";
  const areaId = AREA_IDS[areaName];
  if (!areaId) {
    throw new Error(`未対応のエリアです: ${areaName}（対応: ${Object.keys(AREA_IDS).join("/")}）`);
  }

  const html = await fetchHtml(`https://transit.yahoo.co.jp/diainfo/area/${areaId}`);
  const pageProps = extractPageProps(html);
  if (pageProps.troubleRails === undefined && pageProps.diainfoTrainFeatures === undefined) {
    throw new MarkupChangedError("missing: troubleRails / diainfoTrainFeatures");
  }

  const troubled: LineStatus[] = (pageProps.troubleRails ?? []).map(toLineStatus);
  const result: DiainfoResult = {
    area: String(areaName),
    updateTime: pageProps.updateTimeText || undefined,
    troubled,
  };

  const lineFilter = params.line?.trim();
  if (lineFilter) {
    const hit = troubled.filter((t) => t.line.includes(lineFilter));
    if (hit.length > 0) {
      result.troubled = hit;
    } else {
      const all = collectAllLineNames(pageProps.diainfoTrainFeatures);
      const normalHit = all.filter((n) => n.includes(lineFilter));
      result.troubled = [];
      result.note =
        normalHit.length > 0
          ? `「${lineFilter}」に運行情報はありません（平常運転とみられます: ${normalHit.join("、")}）`
          : `「${lineFilter}」に一致する路線が${areaName}エリアに見つかりませんでした。`;
    }
    return result;
  }

  if (params.onlyTroubled === false) {
    result.normalLines = collectAllLineNames(pageProps.diainfoTrainFeatures).filter(
      (n) => !troubled.some((t) => t.line === n),
    );
  }
  if (troubled.length === 0 && !result.note) {
    result.note = `${areaName}エリアで運行情報のある路線はありません（平常運転）。`;
  }
  return result;
}
