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
export { Identifiers, type ProjectDto } from "@loadbearing/contracts";

// ── @loadbearing/feature ─────────────────────────────────────────────────────
export {
  AccountPanel,
  ActiveSessionList,
  ActivityList,
  ApiKeyList,
  ChangeEmailForm,
  ChangePasswordForm,
  CreateApiKeyForm,
  CreateOrganizationForm,
  CreateRoleForm,
  DeleteTenantPanel,
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
  InvitationLinkJoin,
  InvitationLinkPanel,
  InvitationList,
  InviteMemberForm,
  LinkedAccountList,
  MemberAccessPanel,
  MemberCount,
  MemberDomainPanel,
  MemberList,
  MessageProvider,
  ModuleNav,
  ModuleSwitchPanel,
  NotificationBell,
  NotificationList,
  NotificationPreferenceForm,
  OrganizationEntitlementPanel,
  OrganizationMenu,
  OrganizationSettingsPanel,
  OrganizationSwitcher,
  PlanList,
  PlatformNav,
  PlatformStatusPanel,
  ProfileForm,
  ProjectAccessMatrix,
  ProjectCreateForm,
  ProjectList,
  ProjectSettings,
  type ProjectSettingsTab,
  ReplicaSwitchPanel,
  ResetPasswordForm,
  RoleList,
  RoleMatrix,
  SessionProvider,
  type SessionUser,
  SignInForm,
  SignOutButton,
  SignUpForm,
  SocialSignIn,
  TeamList,
  TeamMembersPanel,
  TenantExportPanel,
  TwoFactorForm,
  TwoFactorPanel,
  TwoFactorSetup,
  UserMenu,
  useCapabilities,
  useErrorMessage,
  useIsPlatformOrganization,
  useMessages,
  useSession,
  VerifyEmailNotice,
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
  PLATFORM_ROUTE_PERMISSION,
  ROUTES,
} from "@loadbearing/permissions";

// ── @loadbearing/query ───────────────────────────────────────────────────────
export {
  ApiClientProvider,
  ApiKeyQueries,
  createQueryClient,
  DocQueries,
  MemberQueries,
  NotificationQueries,
  OrganizationMutations,
  PlatformQueries,
  ProjectQueries,
  RealtimeProvider,
  RoleQueries,
  useApiClient,
  useAppQuery,
} from "@loadbearing/query";

// ── @loadbearing/ui ──────────────────────────────────────────────────────────
export {
  ActionMenu,
  AlertDialog,
  Avatar,
  type BadgeTone,
  Button,
  type ButtonVariant,
  buttonClassName,
  Callout,
  type CalloutTone,
  Can,
  Card,
  CardGrid,
  CodeList,
  cn,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  type FontKey,
  FontRegistry,
  Icon,
  type IconName,
  Input,
  type LinkAttributes,
  Menu,
  type ModeKey,
  type ModePreference,
  ModeRegistry,
  PageScrollbar,
  Popover,
  Prose,
  QrCode,
  ResizablePanels,
  RoleDot,
  type RoleTone,
  readerClassName,
  Select,
  Sidebar,
  StatusBadge,
  Tabs,
  Textarea,
  type ThemeKey,
  ThemeRegistry,
  ThemeScope,
  ThemeToggle,
  Tooltip,
} from "@loadbearing/ui";

// ── @tanstack/react-query ────────────────────────────────────────────────────
export {
  type DehydratedState,
  dehydrate,
  hydrate,
  type QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";

// ── @tanstack/react-router ───────────────────────────────────────────────────
// `router.tsx` only. Everything under `route/` imports this package directly.
export { createRouter } from "@tanstack/react-router";

// ── @tanstack/react-start ────────────────────────────────────────────────────
// Not a `/server` entry, so unlike the three `*.fn.ts` files this one goes through
// the surface. The plugin strips each branch from the build that does not run it.
export { createIsomorphicFn } from "@tanstack/react-start";

// ── react ────────────────────────────────────────────────────────────────────
export { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";

// ── zod ──────────────────────────────────────────────────────────────────────
// Search-parameter schemas only: a route validates what a browser put in its own URL
// bar, and the wire shapes are `contracts`' business.
export { z } from "zod";
