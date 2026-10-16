export interface RouteStop {
  name: string;
  /** 発車時刻 HH:MM */
  time?: string;
}

export interface RouteLeg {
  /** walk=徒歩 / bus=バス / train=鉄道・その他（路線名から判定） */
  mode: "walk" | "train" | "bus";
  from: string;
  fromTime?: string;
  /** 路線名（種別込み。例: ＪＲ湘南新宿ライン快速）。徒歩は「徒歩N分」 */
  line: string;
  /** 種別を除いた路線名（例: ＪＲ湘南新宿ライン） */
  lineName?: string;
  /** 種別（例: 快速・急行・各駅停車）。路線名末尾から推定 */
  kind?: string;
  destination?: string;
  to: string;
  toTime?: string;
  platform?: { departure?: string; arrival?: string };
  /** 乗車位置（例: [8両] 前） */
  position?: string;
  /** 途中停車駅 */
  stops?: RouteStop[];
  fare?: string;
  delayNotice?: string[];
  /** ページの diaInfoStatus をそのまま（遅延時の形式は未確認のため加工しない） */
  diaInfoStatus?: unknown;
}

export interface RouteCandidate {
  no: number;
  depart: string;
  arrive: string;
  duration: string;
  fare?: string;
  transfers: number;
  distance?: string;
  /** 出発地から最初の駅までの徒歩（分）。駅以外を出発地にしたとき */
  walkStartMin: number;
  /** 最後の駅から目的地までの徒歩（分） */
  walkEndMin: number;
  badges: string[];
  legs: RouteLeg[];
}

export interface RouteResult {
  query: { from: string; to: string; date?: string; time?: string; mode: string };
  routes: RouteCandidate[];
  didYouMean?: { from?: string[]; to?: string[] };
  note?: string;
}

export interface PlaceCandidate {
  name: string;
  kind: "station" | "bus" | "facility";
  /** 駅・バス停コード、または施設のgid */
  id?: string;
  address?: string;
  lat?: number;
  lon?: number;
}

export interface LineStatus {
  line: string;
  company?: string;
  status: string;
  message?: string;
  updatedAt?: string;
}

export interface DiainfoResult {
  area: string;
  updateTime?: string;
  troubled: LineStatus[];
  normalLines?: string[];
  note?: string;
}

export interface StationCandidate {
  name: string;
  stationCode: string;
  address?: string;
}

export interface StationDirection {
  line: string;
  direction: string;
  groupId: string;
}

export interface TimetableDeparture {
  time: string;
  type?: string;
  destination?: string;
  trainName?: string;
  track?: string;
}

export interface TimetableResult {
  station: string;
  line: string;
  direction: string;
  dayType: string;
  departures: TimetableDeparture[];
  note?: string;
}
