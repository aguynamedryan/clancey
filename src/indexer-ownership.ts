export function getIndexerOwnershipError(isIndexerInstance: boolean): string | null {
  if (isIndexerInstance) {
    return null;
  }

  return "This instance is search-only; another instance owns indexing.";
}
