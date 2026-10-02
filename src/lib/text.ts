/** `''`/missing/non-string → null, otherwise trimmed. Used for optional
 * free-text fields (e.g. a group's description) shared by
 * create and edit routes. */
export function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Human-readable file size: "812 B", "45 KB", "1.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
