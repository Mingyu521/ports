// Small helpers that turn numbers into words people can read at a glance.

export function formatMemory(bytes?: number): string {
  if (bytes === undefined) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatUptime(started?: Date, now = new Date()): string {
  if (!started) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 60000));
  if (minutes < 1) return "just now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Keeps long command lines to one line in a table.
export function shorten(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
