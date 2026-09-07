/** The page sizes offered anywhere in Bridge, and the one used when a saved
 * List does not name its own (TASK-110). `ViewConfig.pageSize` holds the
 * choice, so it travels with the List rather than with the browser. */
export const PAGE_SIZES = [25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 50;
