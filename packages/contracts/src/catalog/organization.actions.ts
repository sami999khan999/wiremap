export const organizationActions = {
  "organization.updated": { label: "Organization renamed" },
  "organization.ownership.transferred": { label: "Ownership transferred" },
  // The request, recorded before the job: the job's own rows go with the tenant.
  "organization.deletion.requested": { label: "Organization deletion requested" },
} as const;
