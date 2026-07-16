export interface PageResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export async function collectAllPages<T>(
  load: (offset: number, limit: number) => Promise<PageResult<T>>,
  pageSize = 200,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  while (true) {
    const page = await load(offset, pageSize);
    items.push(...page.items);
    if (!page.hasMore) return items;
    if (page.items.length === 0) {
      throw new Error(`Pagination did not advance at offset ${offset} of ${page.total}`);
    }
    offset += page.items.length;
  }
}
