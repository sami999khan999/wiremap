export const apikey = {
  "apikey.title": "API keys",
  "apikey.subtitle": "Credentials for scripts and integrations that act on this organization.",
  "apikey.column.name": "Name",
  "apikey.column.prefix": "Key",
  "apikey.column.scopes": "Scopes",
  "apikey.column.lastUsed": "Last used",
  "apikey.column.status": "Status",
  "apikey.column.actions": "Actions",
  "apikey.status.active": "Active",
  "apikey.status.revoked": "Revoked",
  "apikey.status.expired": "Expired",
  "apikey.lastUsed.never": "Never",
  "apikey.empty": "No API keys yet.",
  "apikey.create.title": "New API key",
  "apikey.create.name": "What is it for?",
  "apikey.create.nameHint": "A name you will recognise in this list in six months.",
  "apikey.create.scopes": "Scopes",
  // The rule the server enforces, said before the request rather than after: a list of
  // checkboxes offering permissions you cannot grant is a list of future 403s.
  "apikey.create.scopesHint": "You can only grant permissions you hold yourself.",
  "apikey.create.submit": "Create key",
  // The whole reason this screen has a modal state at all.
  "apikey.created.title": "Copy this key now",
  "apikey.created.warning":
    "This is the only time it is shown. It is stored as a digest, so nobody — including us — can show it to you again.",
  "apikey.created.done": "I have copied it",
  "apikey.action.revoke": "Revoke",
  "apikey.revoke.confirm": "Revoke {name}? Anything using it stops working immediately.",
  "apikey.error.escalate": "You cannot grant a scope you do not hold yourself.",
  "apikey.error.scopes": "Choose at least one scope the catalog knows.",
  "apikey.error.past": "That expiry is already in the past.",
} as const;
