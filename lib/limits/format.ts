/** Pure byte formatting for limit messages and usage bars (client-safe). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${+(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${+(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}
