/**
 * Cron Utility Functions
 * Pure helper functions for constructing and inspecting cron schedules.
 * Safe to import on both client and server.
 */

/**
 * Builds a standard 5-part cron expression from frequency and preferred execution time.
 * @param frequency "daily" | "every_12_hours" | "hourly" | "custom"
 * @param time "HH:MM" format (24-hour time, e.g. "02:00")
 */
export function buildCronExpression(frequency: string, time: string = "02:00"): string {
  const parts = (time || "02:00").split(":");
  const hour = Math.min(23, Math.max(0, parseInt(parts[0] || "2", 10)));
  const minute = Math.min(59, Math.max(0, parseInt(parts[1] || "0", 10)));

  switch (frequency) {
    case "hourly":
      return `${minute} * * * *`;
    case "every_12_hours":
      return `${minute} ${hour % 12},${(hour % 12) + 12} * * *`;
    case "custom":
      return `${minute} ${hour} * * *`;
    case "daily":
    default:
      return `${minute} ${hour} * * *`;
  }
}

/**
 * Returns a human-friendly description of a cron schedule.
 */
export function describeSchedule(frequency: string, time: string = "02:00"): string {
  switch (frequency) {
    case "hourly":
      return "Hourly at minute 0";
    case "every_12_hours": {
      const parts = (time || "02:00").split(":");
      const hour = parseInt(parts[0] || "2", 10) % 12;
      const min = parts[1] || "00";
      return `Twice daily at ${String(hour).padStart(2, "0")}:${min} and ${String(hour + 12).padStart(2, "0")}:${min}`;
    }
    case "daily":
    default:
      return `Daily at ${time || "02:00"}`;
  }
}
