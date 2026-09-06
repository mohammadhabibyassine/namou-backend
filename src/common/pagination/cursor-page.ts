export interface CursorPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface CursorPage<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}
