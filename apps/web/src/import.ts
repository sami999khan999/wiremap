// **The first of this app's two outside surfaces**, and the client-safe one: a
// server-only package here is the leak. See docs/reference/import-surfaces.md.

// ── @loadbearing/api-client ──────────────────────────────────────────────────
// `AuthClient` is constructed per component, never a module singleton: the instance
// differs per environment.
export {
  AccountClient,
  ApiClient,
  type AppClientContext,
  AuthClient,
  CookieAuthStrategy,
  OrganizationClient,
} from "@loadbearing/api-client";

// ── @loadbearing/content ─────────────────────────────────────────────────────
// The client catalog, never `SERVER_CATALOG`: the `email` namespace is the worker's, and
// the ESLint ban fires on this line.
export {
  type ClientNamespace,
  ContentSource,
  type Locale,
  Locales,
  type MessageSnapshot,
  MessageStore,
  StaticContentSource,
} from "@loadbearing/content";
export type {
  DocNavNodeDto,
  DocPageDraftDto,
  DocPageId,
  DocReadingDto,
  DocSearchHitDto,
  DocSpaceDto,
  DocSpaceId,
  OrganizationId,
  UserId,
} from "@loadbearing/contracts";
// ── @loadbearing/contracts ───────────────────────────────────────────────────
// The branded ids a route casts to. The shapes a component renders arrive through
// `@loadbearing/query`.
export { Identifiers } from "@loadbearing/contracts";

// ── @loadbearing/feature ─────────────────────────────────────────────────────
export {
  AccountPanel,
  ActiveSessionList,
  ActivityTrendPanel,
  ApiKeyList,
  ArchivedNotificationList,
  ChangeEmailForm,
  ChangePasswordForm,
  CreateApiKeyForm,
  CreateOrganizationForm,
  CreateRoleForm,
  DashboardZone,
  DeleteTenantPanel,
  DISMISSAL,
  DocEditorForm,
  DocGrantPanel,
  DocNavTree,
  DocPageTreeList,
  DocReaderPanel,
  DocRevisionList,
  type DocSearchHit,
  DocSpaceForm,
  DocSpaceList,
  DocumentSearch,
  EffectivePermissionsInspector,
  FlagList,
  ForgotPasswordForm,
  IndexDocumentForm,
  InvitationAccept,
  InvitationList,
  InviteMemberForm,
  LinkedAccountList,
  MemberAccessPanel,
  MemberList,
  MessageProvider,
  ModuleNav,
  ModuleSwitchPanel,
  NotificationBell,
  NotificationList,
  NotificationPreferenceForm,
  OrganizationEntitlementPanel,
  OrganizationSwitcher,
  PlanList,
  PlatformStatusPanel,
  ProfileForm,
  ProjectionGapsPanel,
  ProjectionPolicyForm,
  ProjectionSwitchPanel,
  prefetchDashboard,
  ReplicaSwitchPanel,
  ResetPasswordForm,
  RestorePartitionPanel,
  RetentionPolicyForm,
  RoleList,
  RoleMatrix,
  SessionProvider,
  type SessionUser,
  ShardMapPanel,
  SignInForm,
  SignOutButton,
  SignUpForm,
  SocialSignIn,
  TenantExportPanel,
  TenantRetentionForm,
  TenantStorageList,
  TwoFactorForm,
  TwoFactorPanel,
  TwoFactorSetup,
  useCapabilities,
  useErrorMessage,
  useIsPlatformOrganization,
  useMessages,
  useSession,
  VerifyEmailNotice,
  Widget,
  WidgetDefaultForm,
  widgetFacts,
} from "@loadbearing/feature";

// ── @loadbearing/permissions ─────────────────────────────────────────────────
// The same `can()` the server calls, which is why the guard rebuilds the DTO rather than
// shape-checking the JSON.
export {
  CapabilitySet,
  type CapabilitySetDto,
  type FlagKey,
  FlagRegistry,
  type PermissionKey,
  ROUTES,
  WidgetRegistry,
} from "@loadbearing/permissions";

// ── @loadbearing/query ───────────────────────────────────────────────────────
export {
  AnalyticsQueries,
  ApiClientProvider,
  ApiKeyQueries,
  createQueryClient,
  DocQueries,
  MemberQueries,
  NotificationQueries,
  PlatformQueries,
  RealtimeProvider,
  RoleQueries,
  useApiClient,
  useAppQuery,
  WidgetQueries,
} from "@loadbearing/query";

// ── @loadbearing/ui ──────────────────────────────────────────────────────────
export {
  type BadgeTone,
  Button,
  type ButtonVariant,
  Callout,
  type CalloutTone,
  Can,
  CodeList,
  DataTable,
  EmptyState,
  Field,
  type FontKey,
  FontRegistry,
  Icon,
  Input,
  type LinkAttributes,
  type ModeKey,
  type ModePreference,
  ModeRegistry,
  Popover,
  QrCode,
  StatusBadge,
  type ThemeKey,
  ThemeRegistry,
  Zone,
} from "@loadbearing/ui";

// ── @loadbearing/ui — stylesheets ────────────────────────────────────────────
// The order they are written into <head> matters, not the order here: `class.css` reads
// the token names `theme.css` defines.
export { default as classCss } from "@loadbearing/ui/class.css?url";
export { default as themeCss } from "@loadbearing/ui/theme.css?url";

// ── @tanstack/react-query ────────────────────────────────────────────────────
export {
  type DehydratedState,
  dehydrate,
  hydrate,
  type QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

// ── @tanstack/react-router ───────────────────────────────────────────────────
// `router.tsx` only. Everything under `route/` imports this package directly.
export { createRouter } from "@tanstack/react-router";

// ── @tanstack/react-start ────────────────────────────────────────────────────
// Not a `/server` entry, so unlike the three `*.fn.ts` files this one goes through
// the surface. The plugin strips each branch from the build that does not run it.
export { createIsomorphicFn } from "@tanstack/react-start";

// ── react ────────────────────────────────────────────────────────────────────
export { type CSSProperties, type ReactNode, useMemo, useState } from "react";

// ── zod ──────────────────────────────────────────────────────────────────────
// Search-parameter schemas only: a route validates what a browser put in its own URL
// bar, and the wire shapes are `contracts`' business.
export { z } from "zod";
