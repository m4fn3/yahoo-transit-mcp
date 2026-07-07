/** 開発用: 任意条件で searchRoute を1回実行する */
import { searchRoute } from "../src/scrapers/route.js";

const [from = "東京", to = "大阪", date, time, mode] = process.argv.slice(2);
const r = await searchRoute({
  from,
  to,
  date,
  time,
  mode: (mode as any) ?? "departure",
});
console.log(JSON.stringify(r, null, 1));
