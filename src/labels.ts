// Ports that belong to Vexy when it runs on this computer, so an admin can
// spot them at a glance.
export function vexyLabel(port: number): string | undefined {
  if (port === 3000) return "Vexy website";
  if (port >= 54321 && port <= 54324) return "Vexy database";
  return undefined;
}
