export const platformActions = {
  "platform.policy.changed": { label: "Platform policy changed" },
  "platform.projection.paused": { label: "Projection paused" },
  "platform.projection.resumed": { label: "Projection resumed" },
  "platform.replica.enabled": { label: "Replica reads enabled" },
  "platform.replica.disabled": { label: "Replica reads disabled" },
  // Entitlement. A change to one org is audited twice: in the tier, and in that org's own
  // log, so its admins can see what the platform did to their plan.
  "plan.saved": { label: "Plan saved" },
  "plan.deleted": { label: "Plan deleted" },
  "plan.default.changed": { label: "Default plan changed" },
  "organization.plan.changed": { label: "Organization moved to a plan" },
  "entitlement.adjusted": { label: "Entitlement adjusted" },
  "entitlement.adjustment.cleared": { label: "Entitlement adjustment cleared" },
  "entitlement.adjustment.expired": { label: "Entitlement adjustment expired" },
  "module.disabled": { label: "Module switched off" },
  "module.enabled": { label: "Module switched back on" },
  // The payload names the flag. It is an audit row a platform admin reads, never a response.
  "flag.enabled": { label: "Flag switched on" },
  "flag.disabled": { label: "Flag switched off" },
  "flag.organization.added": { label: "Flag switched on for an organization" },
  "flag.organization.removed": { label: "Flag switched off for an organization" },
  "platform.restore.requested": { label: "Restore requested" },
  "platform.reproject.requested": { label: "Re-projection requested" },
  "tenant.retention.changed": { label: "Tenant retention changed" },
  // Two, because the delete is a job now: one says who asked and when, the other says
  // what it cost. A failed job leaves the first without the second, which is the point.
  "tenant.delete_requested": { label: "Tenant delete requested" },
  "tenant.deleted": { label: "Tenant deleted" },
  // Two again, for the reason the delete has two: one says who asked, the other says
  // what it cost. A failed move leaves the first without the second.
  "tenant.move_requested": { label: "Tenant move requested" },
  "tenant.moved": { label: "Tenant moved" },
  "tenant.export_requested": { label: "Tenant export requested" },
  // Not a platform admin's doing — enrolment writes it — but it is the tenant
  // lifecycle, which is what the rest of this fragment is.
  "organization.created": { label: "Organization created" },
  // Audited in the tier and in every tenant the account belongs to. A platform deny reuses
  // `override.denied`, with `authority` in its payload.
  "account.suspended": { label: "Account suspended by the platform" },
  "account.reinstated": { label: "Account reinstated by the platform" },
} as const;
