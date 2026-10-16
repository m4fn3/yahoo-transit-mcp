# yahoo-transit-mcp

[![CI](https://github.com/m4fn3/yahoo-transit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/m4fn3/yahoo-transit-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

[Yahoo!乗換案内](https://transit.yahoo.co.jp/) の**非公式** MCP（Model Context Protocol）サーバーです。Claude Code / Claude Desktop などのMCPクライアントから、日本の電車の**経路検索・終電・運行情報・駅時刻表**を調べられるようになります。

> このリポジトリは [groundcobra009/yahoo-transit-mcp](https://github.com/groundcobra009/yahoo-transit-mcp) のフォークです。住所・施設・座標からの経路検索、地点候補（`suggest_place`）、区間ごとの種別・途中停車駅・乗車位置、到着/出発日時の ISO 指定、オフラインテストを追加しています。既存ツールの入力・出力は後方互換です（[変更点](#フォークでの変更点)）。

> **Unofficial** MCP server for Yahoo! Transit (transit.yahoo.co.jp), a Japanese transit directions service. Provides route search (incl. last/first train), realtime service disruption info, and station timetables as MCP tools. No authentication required. Japanese rail network only.

![Claude Codeでの利用イメージ](docs/images/demo-claude.svg)

## できること

| ツール | 説明 |
|---|---|
| `search_route` | 経路検索。出発地・目的地は**駅名・住所・施設名・座標**に対応。出発・到着時刻指定（`arriveBy` / `departAt` も可）のほか、**終電**（`mode: last_train`）・**始発**（`mode: first_train`）に対応。時刻・所要時間・運賃・乗換回数・前後の徒歩分数と、区間ごとの路線/種別/行き先/番線/乗車位置/途中停車駅/リアルタイム遅延情報を返す |
| `suggest_place` | 地名の一部から**駅・バス停・施設の候補**を座標つきで返す（サイトの検索窓の入力補完と同じ） |
| `get_train_status` | 運行情報（遅延・運転見合わせ）。8地方エリア別。路線名で絞り込むと平常運転かどうかも確認できる |
| `search_station` | 駅名から駅コードを検索。候補が1件なら路線・方面一覧も返す |
| `get_timetable` | 駅の発車時刻表。路線・方面・平日/土曜/日祝・時間帯で絞り込み |

認証・APIキー・環境変数は**一切不要**です（ログイン不要の公開ページのみを利用するため）。

## クイックスタート

Node.js 18以上が必要です。

### Claude Code

プロジェクトの `.mcp.json` に追加します:

```json
{
  "mcpServers": {
    "transit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:m4fn3/yahoo-transit-mcp"]
    }
  }
}
```

またはCLIで:

```bash
claude mcp add transit -- npx -y github:m4fn3/yahoo-transit-mcp
```

### Claude Desktop

`claude_desktop_config.json` に追加します:

```json
{
  "mcpServers": {
    "transit": {
      "command": "npx",
      "args": ["-y", "github:m4fn3/yahoo-transit-mcp"]
    }
  }
}
```

### クローンして使う場合

```bash
git clone https://github.com/m4fn3/yahoo-transit-mcp.git
cd yahoo-transit-mcp
npm ci && npm run build
# → MCPクライアントには command: "node", args: ["/path/to/yahoo-transit-mcp/dist/index.js"] で登録
```

登録後、「明日の朝9時までに大阪駅に着きたい」「山手線は遅れてる？」「終電何時？」のように話しかけるだけで使えます。

## 出力例

`search_route(from: "東京", to: "大阪")` の実際の返り値（抜粋）:

```json
{
  "routes": [
    {
      "no": 1,
      "depart": "06:00",
      "arrive": "08:40",
      "duration": "2時間40分",
      "fare": "13,870円",
      "transfers": 1,
      "badges": ["早"],
      "legs": [
        {
          "from": "東京", "fromTime": "06:00",
          "line": "ＪＲ新幹線のぞみ1号", "destination": "博多行",
          "to": "新大阪", "toTime": "08:22",
          "platform": { "departure": "14番線", "arrival": "21番線" },
          "fare": "8,910円"
        },
        {
          "from": "新大阪", "fromTime": "08:36",
          "line": "ＪＲ直通快速107号",
          "to": "大阪", "toTime": "08:40",
          "platform": { "departure": "3番線" }
        }
      ]
    }
  ]
}
```

施設から施設への到着時刻指定 `search_route(from: "東京タワー", to: "東京スカイツリー", arriveBy: "2026-10-20T10:00", maxRoutes: 1)`（抜粋・途中停車駅は省略）:

```json
{
  "routes": [
    {
      "no": 1,
      "depart": "09:21",
      "arrive": "09:59",
      "duration": "38分",
      "transfers": 0,
      "walkStartMin": 11,
      "walkEndMin": 5,
      "legs": [
        { "mode": "walk", "from": "東京タワー", "fromTime": "09:21", "line": "徒歩11分", "to": "大門(東京都)", "toTime": "09:32" },
        {
          "mode": "train", "from": "大門(東京都)", "fromTime": "09:35",
          "line": "都営浅草線", "lineName": "都営浅草線", "destination": "青砥行",
          "to": "本所吾妻橋", "toTime": "09:52",
          "platform": { "departure": "2番線", "arrival": "2番線" },
          "position": "[8両] 前",
          "stops": [{ "name": "新橋", "time": "09:37" }, { "name": "東銀座", "time": "09:39" }]
        },
        { "mode": "walk", "from": "本所吾妻橋", "fromTime": "09:54", "line": "徒歩5分", "to": "東京スカイツリー", "toTime": "09:59" }
      ]
    }
  ]
}
```

スモークテスト（`npm run smoke`）で全ツールを実データ検証できます:

![スモークテストの実行結果](docs/images/demo-smoke.svg)

## 動作原理

公式APIは存在しないため、このサーバーは**公開ページに埋め込まれた構造化データ**を読み取ります。

![アーキテクチャ](docs/images/architecture.svg)

Yahoo!乗換案内はNext.jsで構築されており、サーバーサイドレンダリングされた各ページには、画面表示用の全データが `<script id="__NEXT_DATA__">` タグ内のJSONとして同梱されています（Reactのハイドレーション用・Next.jsの標準動作）。このサーバーはブラウザと同じようにページをGETし、このJSONだけを抽出してパースします。

- 経路・運行情報・時刻表はページのみを読み、Yahooのバックエンドエンドポイントを直接叩きません（トークン取得なし）
- 例外として `suggest_place` は、サイトの検索窓が入力補完に使う**非公開の** `https://transit.yahoo.co.jp/api/suggest?value=` をブラウザと同じように1回GETします（認証なし）。公開・文書化されたAPIではないため、**予告なく仕様変更・廃止・アクセス制限される可能性があります**
- CSSセレクタに依存しないため、見た目のリニューアル程度では壊れません
- ページ構造が大きく変わって解析できなくなった場合は、`MarkupChangedError` がツール結果として明示的に返ります（黙って誤った経路を返すことはありません）

## ツールリファレンス

### `search_route` — 経路検索

| パラメータ | 型 | 説明 |
|---|---|---|
| `from` / `to` | string（必須） | 出発・到着の駅名・住所・施設名（例: `東京タワー`、`東京都港区芝公園4丁目2-8`）。駅以外なら駅までの徒歩も経路に含まれる |
| `fromLatLon` / `toLatLon` | `{lat, lon}` | 座標で地点を指定（`suggest_place` の結果など）。`from` / `to` は表示名になる。内部では `flatlon` / `tlatlon` パラメータ |
| `via` | string[] | 経由駅（最大3つ） |
| `date` / `time` | string | `YYYY-MM-DD` / `HH:MM`（省略時は現在日時） |
| `mode` | enum | `departure`（出発・既定）/ `arrival`（到着）/ `first_train`（始発）/ `last_train`（終電） |
| `arriveBy` / `departAt` | string | ISO 8601日時（例: `2026-10-20T10:00+09:00`、オフセット省略時はJST）。`mode` + `date` / `time` の別表記で、指定時はこちらが優先。同時指定不可 |
| `maxRoutes` | number | 返す経路の最大件数（1〜10、省略時はページにある全件） |
| `sort` | enum | `time`（到着が早い・既定）/ `fare`（安い）/ `transfers`(乗換少ない) |
| `ticket` | enum | `ic`（既定）/ `normal`（きっぷ） |
| `useShinkansen` ほか | boolean | 新幹線 / 有料特急 / 飛行機 / 高速バスの利用可否（既定: true） |

駅名が曖昧な場合は候補リスト（`didYouMean`）を返します。

返り値の主なフィールド（★はフォークで追加）:

| 場所 | フィールド | 説明 |
|---|---|---|
| 経路 | `depart` / `arrive` / `duration` / `fare` / `transfers` / `badges` / `legs` | 出発（徒歩込み）・到着・所要時間・運賃・乗換回数・早/楽/安・区間 |
| 経路 | ★`walkStartMin` / ★`walkEndMin` | 出発地から最初の駅まで／最後の駅から目的地までの徒歩（分） |
| 区間 | `from` / `fromTime` / `to` / `toTime` / `line` / `destination` / `platform` / `fare` / `delayNotice` | 従来どおり。`line` は種別込みの路線名（徒歩は `徒歩N分`） |
| 区間 | ★`mode` | `walk` / `train` / `bus`（路線名から判定） |
| 区間 | ★`lineName` / ★`kind` | 種別を除いた路線名と種別（例: `ＪＲ湘南新宿ライン` + `快速`）。路線名末尾から推定 |
| 区間 | ★`position` | 乗車位置（例: `[8両] 前`） |
| 区間 | ★`stops` | 途中停車駅 `{name, time}` の一覧 |
| 区間 | ★`diaInfoStatus` | ページの遅延情報をそのまま（遅延時の形式は未確認のため加工しない） |

番線が「情報なし」の場合は、その番線を省略します（従来は文字列 `情報なし` を返していました）。

### `suggest_place` — 地点候補

| パラメータ | 型 | 説明 |
|---|---|---|
| `query` | string（必須） | 地名・施設名・駅名の一部（例: `東京タワー`） |

`{ candidates: [{ name, kind: "station" | "bus" | "facility", id?, address?, lat?, lon? }] }` を返します。住所そのものは候補に出ないので、住所は `search_route` の `from` / `to` に直接渡してください。施設を選んだら `name` と `lat` / `lon` を `from` + `fromLatLon` に渡すと、その地点からの経路になります。

### `get_train_status` — 運行情報

| パラメータ | 型 | 説明 |
|---|---|---|
| `area` | enum | `北海道` `東北` `関東`（既定）`中部` `近畿` `中国` `四国` `九州` |
| `line` | string | 路線名の部分一致フィルタ（例: `山手線`）。異常がなければ平常運転と分かる |
| `onlyTroubled` | boolean | `false` で平常運転の路線名一覧も返す |

### `search_station` — 駅検索

| パラメータ | 型 | 説明 |
|---|---|---|
| `query` | string（必須） | 駅名（例: `新宿`） |

### `get_timetable` — 駅時刻表

| パラメータ | 型 | 説明 |
|---|---|---|
| `station` | string（必須） | 駅名または駅コード |
| `line` / `direction` | string | 路線名・方面の部分一致。曖昧なら候補一覧がエラーとして返るので絞り込んで再実行 |
| `dayType` | enum | `weekday`（既定）/ `saturday` / `holiday` |
| `hourFrom` / `hourTo` | number | 返す時間帯（0〜27時台） |

## アクセスマナー（実装で強制）

相手サーバーに負荷をかけないため、以下をコードで強制しています（`suggest_place` を含む全ツール共通）:

- 全リクエストの**直列化**＋**1.5秒以上の間隔**（`src/fetch.ts`）
- URL単位の**15分キャッシュ**
- 10秒タイムアウト・リトライは通信エラー時の1回のみ

対話的な利用を想定したツールです。**ポーリング・一括クロール・大量取得には使わないでください。**

## 開発

```bash
npm ci          # 依存インストール
npm run build   # TypeScriptビルド（dist/）
npm run lint    # 型チェック（tsc --noEmit）
npm test        # オフラインテスト（保存済みフィクスチャ・ネットワーク不要）
npm run smoke   # 実サイトに対する動作確認（約6リクエスト・直列）
npx tsx scripts/try-route.ts 東京 大阪 2026-07-10 09:00 arrival  # 単発の経路検索
```

CIでは lint / build / test を実行します。テストのフィクスチャ（`test/fixtures/`）は実サイトから保存した公開地点（東京タワー・東京スカイツリー・渋谷）のデータのみです。`smoke` は実サイトへアクセスするため、リリース前の手動ゲートとしてローカルで実行してください。

## 免責事項

- 本プロジェクトは**個人による非公式ツール**であり、LINEヤフー株式会社とは一切関係ありません（非公認・非提携）。「Yahoo!」「Yahoo!乗換案内」はサービスの識別のためにのみ言及しており、商標は各権利者に帰属します
- 公開ウェブページの解析と、文書化されていない入力補完エンドポイント（`/api/suggest`）に基づくため、**サイト側の変更により予告なく動作しなくなる可能性**があります
- 取得した情報の正確性は保証されません。実際の運行は公式情報を確認してください
- 本ソフトウェアの利用は**自己責任**です。利用者は対象サービスの利用規約を自身で確認し、過度なアクセス・商用利用・取得データの再配布を行わないでください

## フォークでの変更点

- `search_route`: 住所・施設名に加えて座標（`fromLatLon` / `toLatLon`）で地点を指定可能に。`arriveBy` / `departAt`（ISO 8601）と `maxRoutes` を追加
- 経路に `walkStartMin` / `walkEndMin`、区間に `mode` / `lineName` / `kind` / `position` / `stops` / `diaInfoStatus` を追加
- 番線「情報なし」を未設定として扱うよう修正
- 新ツール `suggest_place`
- `npm test`（node:test・保存済みフィクスチャ）を追加し、CIで実行

既存のパラメータと返り値のフィールドはそのまま残しています。

## ライセンス

[MIT](LICENSE) © keitaro ([groundcobra009](https://github.com/groundcobra009))。フォークでの変更分も同じ MIT ライセンスです。
