/** meta.page of a table (offset pagination). */
export interface OffsetPage {
  limit: number;
  offset: number;
  total: number;
}

/** meta.page of a feed (cursor pagination); feeds have no total. */
export interface CursorPage {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export type PageMeta = OffsetPage | CursorPage;

/** One page of rows, as CrudQueryService returns it. */
export interface Page<T> {
  items: T[];
  page: PageMeta;
}

export const isOffsetPage = (page: PageMeta): page is OffsetPage =>
  'offset' in page;

/** What a list endpoint's query string may carry (ListQueryDto validates the shape). */
export interface ListQuery {
  limit?: number;
  offset?: number;
  cursor?: string;
  sort?: string;
  q?: string;
  include?: string;
  /** filter[field]=a,b or filter[field][op]=value, parsed by Express's extended query parser. */
  filter?: Record<string, unknown>;
}

export const PAGE_LIMITS = {
  offset: { default: 10, max: 100 },
  cursor: { default: 50, max: 200 },
} as const;
