// The two bans made visible: the transport package appears once and only as a type, and
// the router package not at all. Both are enforced in the root ESLint config.

// ── @loadbearing/api-client ──────────────────────────────────────────────────
// Type-only. The instance arrives as a prop, so this creates no runtime dependency and
// no read can bypass a defined query.
export type { AccountClient, AuthClient, OrganizationClient } from "@loadbearing/api-client";
export type {
  ClientNamespace,
  MessageParams,
  MessageStore,
  NamespaceKeys,
  NavItem,
  ShellNamespace,
  Translator,
} from "@loadbearing/content";
// ── @loadbearing/content ─────────────────────────────────────────────────────
// `ErrorCopy` rather than its map: that map has a fallback rule.
export { ErrorCopy } from "@loadbearing/content";
// ── @loadbearing/contracts ───────────────────────────────────────────────────
// The shapes the server returns, plus the one value: `Password` carries the bounds the
// server enforces, so a form cannot advertise a different floor.
export {
  type AccountDenyDto,
  type AccountDto,
  type AccountMembershipDto,
  type AdjustmentDto,
  type ApiKeyDto,
  ApiKeyEntity,
  type CapabilitiesDto,
  type DocGrantKind,
  type DocNavNodeDto,
  type DocPageDraftDto,
  type DocPageId,
  type DocPageKind,
  type DocPageNodeDto,
  type DocPageStatus,
  type DocReadingDto,
  type DocRevisionSummaryDto,
  type DocSearchHitDto,
  type DocSpaceAudience,
  type DocSpaceDto,
  type DocSpaceId,
  type DocumentHitDto,
  type ExplanationDto,
  type FlagDto,
  type InvitationDto,
  type MemberDto,
  type NotificationDto,
  type NotificationPreferenceDto,
  type OrganizationId,
  type OverrideEntityDto,
  Password,
  type PlanDto,
  type RoleDto,
} from "@loadbearing/contracts";

// ── @loadbearing/errors ──────────────────────────────────────────────────────
export { type ErrorEnvelope, ErrorNormalizer } from "@loadbearing/errors";

// ── @loadbearing/permissions ─────────────────────────────────────────────────
export {
  CapabilitySet,
  type CapabilitySetDto,
  CORE_MODULE,
  type FlagKey,
  type ModuleKey,
  ModuleRegistry,
  type PermissionKey,
  PermissionRegistry,
  type PermissionScope,
} from "@loadbearing/permissions";

// ── @loadbearing/query ───────────────────────────────────────────────────────
// Defined queries and the two runtime hooks, never the cache library: a component naming
// `useQuery` directly would be a read outside the seam.
export {
  AccountMutations,
  AccountQueries,
  ApiKeyMutations,
  ApiKeyQueries,
  DocMutations,
  DocQueries,
  DocumentMutations,
  MemberMutations,
  MemberQueries,
  NotificationMutations,
  NotificationQueries,
  OrganizationMutations,
  OverrideMutations,
  OverrideQueries,
  PlatformMutations,
  PlatformQueries,
  type QueryRuntime,
  RoleMutations,
  RoleQueries,
  SessionMutations,
  useApiClient,
  useAppInfiniteQuery,
  useAppQuery,
} from "@loadbearing/query";

// ── @loadbearing/ui ──────────────────────────────────────────────────────────
export {
  type BadgeTone,
  Button,
  ByteFormat,
  buttonClassName,
  Callout,
  Can,
  Card,
  CardGrid,
  CodeList,
  CommandDialog,
  type CommandGroup,
  DataTable,
  DateFormat,
  dataTableClassName,
  EmptyState,
  Field,
  fieldClassName,
  Icon,
  type IconName,
  IconRegistry,
  Input,
  type LinkAttributes,
  Menu,
  type MenuOption,
  type ModeKey,
  NavTree,
  type NavTreeNode,
  Popover,
  Prose,
  QrCode,
  ReaderLayout,
  readerClassName,
  SearchTrigger,
  Select,
  Sidebar,
  StatusBadge,
  type TableColumn,
  Textarea,
  type ThemeKey,
  ThemeRegistry,
  ThemeToggle,
  Toc,
  useHotkey,
} from "@loadbearing/ui";

// ── react ────────────────────────────────────────────────────────────────────
export {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
