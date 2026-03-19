export interface ParsedBitableUrl {
  appToken: string;
  tableId?: string;
  viewId?: string;
  isWiki: boolean;
}

/**
 * Parse common Bitable and Wiki URL formats into app/table identifiers.
 */
export function parseBitableUrl(url: string): ParsedBitableUrl {
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const parsed = new URL(normalizedUrl);
  const pathname = parsed.pathname;

  const wikiMatch = pathname.match(/\/wiki\/([A-Za-z0-9_-]+)/);
  if (wikiMatch) {
    return {
      appToken: wikiMatch[1],
      tableId: parsed.searchParams.get('table') ?? undefined,
      viewId: parsed.searchParams.get('view') ?? undefined,
      isWiki: true,
    };
  }

  const baseMatch = pathname.match(/\/base\/([A-Za-z0-9_-]+)/);
  if (baseMatch) {
    return {
      appToken: baseMatch[1],
      tableId: parsed.searchParams.get('table') ?? undefined,
      viewId: parsed.searchParams.get('view') ?? undefined,
      isWiki: false,
    };
  }

  const shortMatch = pathname.match(/\/([A-Za-z0-9_-]+)_(tbl[A-Za-z0-9_-]+)/);
  if (shortMatch) {
    return {
      appToken: shortMatch[1],
      tableId: shortMatch[2],
      viewId: parsed.searchParams.get('view') ?? undefined,
      isWiki: false,
    };
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0) {
    return {
      appToken: segments[segments.length - 1],
      tableId: parsed.searchParams.get('table') ?? undefined,
      viewId: parsed.searchParams.get('view') ?? undefined,
      isWiki: false,
    };
  }

  throw new Error(`Cannot parse Feishu/Lark Bitable URL: ${url}`);
}
