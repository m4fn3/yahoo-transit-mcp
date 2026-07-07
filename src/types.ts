export interface RouteLeg {
  from: string;
  fromTime?: string;
  line: string;
  destination?: string;
  to: string;
  toTime?: string;
  platform?: { departure?: string; arrival?: string };
  fare?: string;
  delayNotice?: string[];
}

export interface RouteCandidate {
  no: number;
  depart: string;
  arrive: string;
  duration: string;
  fare?: string;
  transfers: number;
  distance?: string;
  badges: string[];
  legs: RouteLeg[];
}

export interface RouteResult {
  query: { from: string; to: string; date?: string; time?: string; mode: string };
  routes: RouteCandidate[];
  didYouMean?: { from?: string[]; to?: string[] };
  note?: string;
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
