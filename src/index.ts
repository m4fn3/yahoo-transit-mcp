#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchRoute } from "./scrapers/route.js";
import { AREA_IDS, getTrainStatus } from "./scrapers/diainfo.js";
import { getTimetable, listDirections, resolveStation } from "./scrapers/timetable.js";

const server = new McpServer({
  name: "transit-yahoo",
  version: "0.1.0",
});

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] };
}

function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

server.registerTool(
  "search_route",
  {
    title: "経路検索（Yahoo!乗換案内）",
    description:
      "出発地から目的地までの電車経路を検索する。時刻・所要時間・運賃・乗換回数・各区間の路線と番線を返す。終電は mode=last_train、始発は mode=first_train。",
    inputSchema: {
      from: z.string().describe("出発駅・地名（例: 東京、渋谷）"),
      to: z.string().describe("到着駅・地名"),
      via: z.array(z.string()).max(3).optional().describe("経由駅（最大3つ）"),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("日付 YYYY-MM-DD（省略時は今日）"),
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .describe("時刻 HH:MM（省略時は現在時刻）"),
      mode: z
        .enum(["departure", "arrival", "first_train", "last_train"])
        .default("departure")
        .describe("departure=出発時刻指定 / arrival=到着時刻指定 / first_train=始発 / last_train=終電"),
      sort: z
        .enum(["time", "fare", "transfers"])
        .default("time")
        .describe("並び順: time=到着が早い / fare=料金が安い / transfers=乗換が少ない"),
      ticket: z.enum(["ic", "normal"]).default("ic").describe("運賃表示: ic=ICカード優先 / normal=きっぷ"),
      useShinkansen: z.boolean().default(true).describe("新幹線を使うか"),
      useExpress: z.boolean().default(true).describe("有料特急を使うか"),
      useAirplane: z.boolean().default(true).describe("飛行機を使うか"),
      useHighwayBus: z.boolean().default(true).describe("高速バスを使うか"),
    },
  },
  async (args) => {
    try {
      return ok(await searchRoute(args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_train_status",
  {
    title: "運行情報（遅延・運転見合わせ）",
    description:
      "鉄道の運行情報（遅延・運転見合わせ等）をエリア別に取得する。line で特定路線に絞り込める（平常運転かどうかも分かる）。",
    inputSchema: {
      area: z
        .enum(Object.keys(AREA_IDS) as [string, ...string[]])
        .default("関東")
        .describe("エリア名"),
      onlyTroubled: z
        .boolean()
        .default(true)
        .describe("false にすると平常運転の路線名一覧も返す"),
      line: z.string().optional().describe("路線名の部分一致フィルタ（例: 山手線）"),
    },
  },
  async (args) => {
    try {
      return ok(await getTrainStatus(args));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "search_station",
  {
    title: "駅検索（駅コード・路線一覧）",
    description:
      "駅名から駅コードを検索する。候補が1件に絞れた場合はその駅の路線・方面一覧（時刻表取得用のgroupId）も返す。get_timetable の前段として使う。",
    inputSchema: {
      query: z.string().describe("駅名（例: 新宿）"),
    },
  },
  async (args) => {
    try {
      const candidates = await resolveStation(args.query);
      if (candidates.length === 1) {
        const { directions } = await listDirections(candidates[0].stationCode);
        return ok({ candidates, directions });
      }
      return ok({ candidates });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "get_timetable",
  {
    title: "駅の時刻表",
    description:
      "指定駅・路線・方面の発車時刻表を取得する。路線・方面が曖昧な場合は候補一覧をエラーとして返すので、それを見て絞り込んで再実行する。",
    inputSchema: {
      station: z.string().describe("駅名 または 駅コード（search_stationで取得）"),
      line: z.string().optional().describe("路線名の部分一致（例: 山手線、東海道新幹線）"),
      direction: z.string().optional().describe("方面の部分一致（例: 品川・渋谷方面 なら 品川）"),
      dayType: z
        .enum(["weekday", "saturday", "holiday"])
        .default("weekday")
        .describe("weekday=平日 / saturday=土曜 / holiday=日祝"),
      hourFrom: z.number().int().min(0).max(27).optional().describe("この時台以降のみ返す"),
      hourTo: z.number().int().min(0).max(27).optional().describe("この時台以前のみ返す"),
    },
  },
  async (args) => {
    try {
      return ok(await getTimetable(args));
    } catch (e) {
      return fail(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("transit-yahoo MCP server running (stdio)");
