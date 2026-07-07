import * as cheerio from "cheerio";

/** Yahoo側のページ構造変更を示すエラー。ツール側でユーザー向けメッセージとして返す */
export class MarkupChangedError extends Error {
  constructor(detail: string) {
    super(
      `Yahoo!乗換案内のページ構造が変わった可能性があります（${detail}）。transit-mcp の更新が必要かもしれません。`,
    );
    this.name = "MarkupChangedError";
  }
}

/** __NEXT_DATA__ から props.pageProps を取り出す */
export function extractPageProps(html: string): any {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").html();
  if (!raw) throw new MarkupChangedError("__NEXT_DATA__ が見つかりません");
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new MarkupChangedError("__NEXT_DATA__ のJSONを解析できません");
  }
  const pageProps = json?.props?.pageProps;
  if (!pageProps) throw new MarkupChangedError("props.pageProps がありません");
  return pageProps;
}

/** pageProps 内の必須キーを検証して返す */
export function requireKey<T = any>(obj: any, key: string): T {
  const v = obj?.[key];
  if (v === undefined || v === null) {
    throw new MarkupChangedError(`missing: ${key}`);
  }
  return v as T;
}
