/**
 * スモークテスト: 実際のYahoo!乗換案内に対してスクレイパーを直接呼ぶ。
 * 実行: npm run smoke
 * 共有レートリミッタにより直列・約1.5s間隔で ~6リクエスト。
 */
import { searchRoute } from "../src/scrapers/route.js";
import { getTrainStatus } from "../src/scrapers/diainfo.js";
import { getTimetable, resolveStation } from "../src/scrapers/timetable.js";

let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
    if (detail !== undefined) console.log(JSON.stringify(detail, null, 2).slice(0, 3000));
  }
}

async function main() {
  console.log("1) 経路検索: 東京→大阪");
  const r1 = await searchRoute({ from: "東京", to: "大阪" });
  check("経路が1件以上", r1.routes.length >= 1, r1);
  const first = r1.routes[0];
  if (first) {
    check("運賃あり", !!first.fare, first);
    check("区間(legs)が1つ以上", first.legs.length >= 1, first.legs);
    check("先頭legに路線名", !!first.legs[0]?.line, first.legs[0]);
    console.log(
      `  → ${first.depart}発 ${first.arrive}着 ${first.duration} ${first.fare} 乗換${first.transfers}回`,
    );
    console.log(`  → leg1: ${JSON.stringify(first.legs[0])}`);
  }

  console.log("2) 終電検索: 新宿→横浜 (mode=last_train)");
  const r2 = await searchRoute({ from: "新宿", to: "横浜", mode: "last_train" });
  check("終電の経路あり", r2.routes.length >= 1, r2);
  if (r2.routes[0]) console.log(`  → ${r2.routes[0].depart}発 ${r2.routes[0].arrive}着`);

  console.log("3) 運行情報: 関東");
  const d = await getTrainStatus({ area: "関東" });
  check("更新時刻あり", !!d.updateTime, d);
  console.log(`  → ${d.updateTime} / 異常${d.troubled.length}件`);
  for (const t of d.troubled.slice(0, 3)) console.log(`  → ${t.line}: ${t.status}`);

  console.log("4) 駅解決: 新宿");
  const st = await resolveStation("新宿");
  check("候補が1件以上", st.length >= 1, st);
  console.log(`  → ${st.slice(0, 5).map((s) => `${s.name}(${s.stationCode})`).join(", ")}`);

  console.log("5) 時刻表: 東京駅・東海道新幹線");
  try {
    const tt = await getTimetable({ station: "東京", line: "東海道新幹線", dayType: "weekday", hourFrom: 6, hourTo: 8 });
    check("発車時刻が1件以上", tt.departures.length >= 1, tt);
    console.log(`  → ${tt.station} ${tt.line} ${tt.direction} ${tt.dayType}`);
    for (const dep of tt.departures.slice(0, 5)) console.log(`  → ${JSON.stringify(dep)}`);
  } catch (e) {
    // 駅名・路線の曖昧性エラーは候補一覧が返る仕様。内容を表示して判断する
    console.log(`  ⚠️ ${e instanceof Error ? e.message : e}`);
    failed++;
  }

  console.log(failed === 0 ? "\nALL OK" : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
