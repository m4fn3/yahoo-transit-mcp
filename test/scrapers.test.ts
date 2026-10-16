/**
 * オフラインテスト: 実サイトから保存した公開地点のみのフィクスチャで解析を検証する。
 * 実行: npm test（ネットワークに出るのはモックした fetch のみ）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRouteUrl, parseRouteResult, splitKind } from "../src/scrapers/route.js";
import { parseSuggest } from "../src/scrapers/suggest.js";
import { fetchHtml } from "../src/fetch.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));

// 東京タワー → 東京スカイツリー、10:00 到着指定（pageProps.naviSearchParam を保存したもの）
test("施設→施設: 前後の徒歩・番線・行き先・乗車位置・途中停車駅", () => {
  const r = parseRouteResult(fixture("route-tokyotower-skytree-arrive1000.json"), {
    from: "東京タワー",
    to: "東京スカイツリー",
    arriveBy: "2026-10-20T10:00+09:00",
  });
  assert.equal(r.query.mode, "arrival");
  assert.equal(r.routes.length, 3);
  const route = r.routes[0];
  assert.deepEqual(
    [route.depart, route.arrive, route.duration, route.transfers, route.walkStartMin, route.walkEndMin],
    ["09:21", "09:59", "38分", 0, 11, 5],
  );
  assert.deepEqual(
    route.legs.map((l) => [l.mode, l.line, l.from, l.to]),
    [
      ["walk", "徒歩11分", "東京タワー", "大門(東京都)"],
      ["train", "都営浅草線", "大門(東京都)", "本所吾妻橋"],
      ["walk", "徒歩5分", "本所吾妻橋", "東京スカイツリー"],
    ],
  );
  const t = route.legs[1];
  assert.deepEqual(
    [t.fromTime, t.toTime, t.lineName, t.kind, t.destination, t.position],
    ["09:35", "09:52", "都営浅草線", undefined, "青砥行", "[8両] 前"],
  );
  assert.deepEqual(t.platform, { departure: "2番線", arrival: "2番線" });
  assert.equal(t.stops?.length, 9);
  assert.deepEqual(t.stops?.[0], { name: "新橋", time: "09:37" });
  assert.equal(route.legs[0].stops, undefined);
  assert.ok(r.routes.every((x) => x.arrive <= "10:00"), "到着指定の候補");
  assert.equal(parseRouteResult(fixture("route-tokyotower-skytree-arrive1000.json"), { from: "a", to: "b", maxRoutes: 1 }).routes.length, 1);
});

// 住所（東京タワーの所在地）→ 渋谷、10:00 出発
test("住所→駅: 種別の分離、番線「情報なし」は未設定", () => {
  const r = parseRouteResult(fixture("route-tokyotower-address-shibuya-depart1000.json"), {
    from: "東京都港区芝公園4丁目2-8",
    to: "渋谷",
  });
  const [a, b] = r.routes;
  assert.deepEqual([a.depart, a.walkStartMin, a.walkEndMin, a.transfers, a.legs[0].from], ["10:00", 8, 0, 1, "東京都港区芝公園4丁目2-8"]);
  const jr = a.legs[2];
  // 既存の line は種別込みのまま（後方互換）。lineName / kind が追加分
  assert.deepEqual([jr.line, jr.lineName, jr.kind, jr.destination], ["ＪＲ湘南新宿ライン快速", "ＪＲ湘南新宿ライン", "快速", "宇都宮行"]);
  assert.equal(a.legs[1].position, "[7両] 中 後");
  assert.equal(jr.position, undefined, "空の position は省略");
  assert.deepEqual(b.legs[2].platform, { departure: "4番線", arrival: undefined });
  assert.equal(b.legs[2].kind, "急行");
  assert.equal(jr.diaInfoStatus, undefined, "空の diaInfoStatus は省略");
});

test("候補なし: didYouMean を返す", () => {
  const r = parseRouteResult({ featureInfoList: [], otherQueryInfo: { fromList: [{ name: "渋谷(東京都)" }] } }, { from: "しぶや", to: "東京" });
  assert.deepEqual(r.routes, []);
  assert.deepEqual(r.didYouMean, { from: ["渋谷(東京都)"], to: undefined });
});

test("splitKind: 路線名末尾の種別", () => {
  for (const [name, line, kind] of [
    ["ＪＲ湘南新宿ライン快速", "ＪＲ湘南新宿ライン", "快速"],
    ["東急東横線急行", "東急東横線", "急行"],
    ["京王線各駅停車", "京王線", "各駅停車"],
    ["ＪＲ中央線通勤快速", "ＪＲ中央線", "通勤快速"],
    ["東京メトロ半蔵門線区間急行", "東京メトロ半蔵門線", "区間急行"],
    ["京急本線快特", "京急本線", "快特"],
    ["ＪＲ中央線中央特快", "ＪＲ中央線", "中央特快"],
    ["小田急線快速急行", "小田急線", "快速急行"],
    ["都営大江戸線", "都営大江戸線", undefined],
    ["日暮里・舎人ライナー", "日暮里・舎人ライナー", undefined],
    ["ＪＲ山手線内回り", "ＪＲ山手線内回り", undefined],
  ] as const) {
    assert.deepEqual(splitKind(name), [line, kind], name);
  }
});

test("buildRouteUrl: arriveBy / departAt / 座標", () => {
  const q = (p: Parameters<typeof buildRouteUrl>[0]) => new URL(buildRouteUrl(p)).searchParams;
  const a = q({ from: "東京タワー", to: "東京スカイツリー", arriveBy: "2026-10-20T10:05" });
  assert.deepEqual(
    ["type", "y", "m", "d", "hh", "m1", "m2"].map((k) => a.get(k)),
    ["4", "2026", "10", "20", "10", "0", "5"],
  );
  // UTC 指定は JST に直す（日付またぎ）
  const d = q({ from: "東京", to: "大阪", departAt: "2026-10-19T23:30:00Z" });
  assert.deepEqual(["type", "d", "hh", "m1", "m2"].map((k) => d.get(k)), ["1", "20", "08", "3", "0"]);
  const c = q({ from: "東京タワー", to: "渋谷", fromLatLon: { lat: 35.6586, lon: 139.7454 } });
  assert.equal(c.get("flatlon"), "35.6586,139.7454,東京タワー");
  assert.equal(c.get("tlatlon"), null);
  // 既存の mode + date/time 指定はそのまま
  const old = q({ from: "東京", to: "大阪", mode: "last_train", date: "2026-07-10", time: "22:15" });
  assert.deepEqual(["type", "y", "hh", "m1", "m2"].map((k) => old.get(k)), ["2", "2026", "22", "1", "5"]);
  assert.throws(() => buildRouteUrl({ from: "a", to: "b", arriveBy: "2026-10-20T10:00", departAt: "2026-10-20T09:00" }), /同時/);
  assert.throws(() => buildRouteUrl({ from: "a", to: "b", departAt: "あした" }), /日時/);
});

test("parseSuggest: 駅・バス停・施設の候補と座標", () => {
  const c = parseSuggest(fixture("suggest-tokyotower.json"));
  assert.equal(c.length, 3);
  assert.deepEqual(c[0], { name: "東京タワー(終点)/都営バス", kind: "bus", id: "36860", lat: 35.65828654800366, lon: 139.7460244251276 });
  assert.deepEqual([c[1].kind, c[1].id, c[1].address], ["facility", "TA-TitysTgc", "東京都港区芝公園4-2-8東京タワー大展望台内"]);
  assert.throws(() => parseSuggest({}), /ページ構造/);
});

test("fetchHtml: 15分キャッシュと1.5秒以上の間隔", async () => {
  const seen: number[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    seen.push(Date.now());
    return new Response("ok");
  }) as typeof fetch;
  try {
    await fetchHtml("https://transit.yahoo.co.jp/test/a");
    await fetchHtml("https://transit.yahoo.co.jp/test/a");
    assert.equal(seen.length, 1, "同じURLはキャッシュから");
    await Promise.all([fetchHtml("https://transit.yahoo.co.jp/test/b"), fetchHtml("https://transit.yahoo.co.jp/test/c")]);
    assert.equal(seen.length, 3);
    assert.ok(seen[1] - seen[0] >= 1450 && seen[2] - seen[1] >= 1450, "同時呼び出しも直列・間隔あり");
  } finally {
    globalThis.fetch = real;
  }
});
