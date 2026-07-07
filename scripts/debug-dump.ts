/** 開発用: 生JSON構造の確認 */
import { fetchHtml, buildUrl } from "../src/fetch.js";
import { extractPageProps } from "../src/nextData.js";

const what = process.argv[2] ?? "route";

if (what === "route") {
  const html = await fetchHtml(buildUrl("/search/result", { from: "東京", to: "大阪", type: 1 }));
  const p = extractPageProps(html);
  const edges = p.naviSearchParam.featureInfoList[0].edgeInfoList;
  console.log("edge count:", edges.length);
  for (const [i, e] of edges.slice(0, 6).entries()) {
    console.log(`--- edge[${i}] keys:`, Object.keys(e).join(","));
    console.log(
      JSON.stringify(
        {
          stationName: e.stationName,
          railName: e.railName,
          timeInfo: e.timeInfo,
          ridingPositionInfo: e.ridingPositionInfo,
        },
        null,
        1,
      ).slice(0, 1200),
    );
  }
} else if (what === "dia") {
  const html = await fetchHtml("https://transit.yahoo.co.jp/diainfo/area/4");
  const p = extractPageProps(html);
  console.log("pageProps keys:", Object.keys(p).join(","));
  console.log(JSON.stringify(p.troubleRails?.[0], null, 1).slice(0, 2500));
}
