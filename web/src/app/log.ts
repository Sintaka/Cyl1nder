/** Bottom log bar helpers. */
export function formatLog(msg: string): string {
  return `[${new Date().toLocaleTimeString()}] ${msg}`;
}