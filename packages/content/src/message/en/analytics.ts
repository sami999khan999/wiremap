export const analytics = {
  "analytics.title": "Activity",
  // Said on the page, because a row that is not here yet reads as a row that was lost:
  // the store trails the audit log by the settle horizon and one projection run.
  "analytics.subtitle":
    "What happened in this organization, day by day. The newest few minutes may not be here yet.",
  "analytics.period.label": "Period",
  "analytics.period.30": "Last 30 days",
  "analytics.period.90": "Last 90 days",
  "analytics.range": "{from} to {to}",
  // A count and a label rather than "{count} events": `Translator` does not pluralise.
  "analytics.total": "Events: {count}",
  "analytics.byDay.title": "By day",
  "analytics.byAction.title": "By action",
  "analytics.column.day": "Day",
  "analytics.column.action": "Action",
  "analytics.column.count": "Events",
  "analytics.empty": "Nothing happened in this period.",
  "analytics.notConfigured": "Analytics are not configured on this deployment.",
  "analytics.failed": "The activity could not be loaded.",
} as const;
