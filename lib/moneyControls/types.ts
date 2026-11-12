import type { Kind, Section, EditableControl } from "./rules";

export type ControlFile = { id: string; filename: string; contentType: string };
export type ControlEvent = {
  id: string;
  workspaceId: string;
  recordId: string;
  actorId: string;
  action: string;
  reference: string;
  notes: string;
  createdAt: string;
};
export type ControlMovement = {
  id: string;
  workspaceId: string;
  recordId: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  occurredOn: string;
  reference: string;
  operationKey: string;
  reconciledAt: string | null;
  createdAt: string;
};
export type ControlRow = {
  id: string;
  workspaceId: string;
  kind: Kind;
  title: string;
  status: string;
  recordKey: string | null;
  number: number | null;
  ownerId: string | null;
  accountId: string | null;
  otherAccountId: string | null;
  assetId: string | null;
  fundId: string | null;
  categoryId: string | null;
  parentId: string | null;
  complianceId: string | null;
  checklistRunId: string | null;
  amountMinor: number;
  settledMinor: number;
  currency: string;
  occurredOn: string;
  endsOn: string;
  dueOn: string;
  reminderDays: number;
  payroll: boolean;
  notes: string;
  details: unknown;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  files: ControlFile[];
  events: ControlEvent[];
  movements: ControlMovement[];
};
export type ControlFilters = {
  section: Section;
  q: string;
  status: string;
  owner: string;
  fundId: string;
  quarter: "" | "Q1" | "Q2" | "Q3" | "Q4" | "ANNUAL";
  kind: Kind | "";
  from: string;
  to: string;
  fiscalYear: number;
  page: number;
};
export type ControlList = {
  q: ControlFilters;
  total: number;
  manage: boolean;
  payrollManage: boolean;
  rows: ControlRow[];
};
export type ControlPickers = {
  accounts: { id: string; name: string; currency: string }[];
  funds: { id: string; name: string; currency: string }[];
  assets: { id: string; name: string }[];
  members: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  records: { id: string; title: string; kind: string }[];
  compliance: { id: string; title: string }[];
  checklists: { id: string; title: string; subjectUserId: string | null }[];
};
export type ControlSummary = {
  balances: {
    id: string;
    name: string;
    currency: string;
    balanceMinor: number;
  }[];
  schedules: {
    id: string;
    title: string;
    currency: string;
    costMinor: number;
    purchaseOn: string;
    openingMinor: number;
    depreciationMinor: number;
    disposalMinor: number;
    closingMinor: number;
  }[];
  funds: {
    id: string;
    fundId: string | null;
    title: string;
    currency: string;
    budgetMinor: number;
    committedMinor: number;
    remainingMinor: number;
    issues: string[];
  }[];
  utilisation: {
    fundId: string | null;
    categoryId: string | null;
    currency: string;
    kind: "INCOME" | "EXPENSE";
    _sum: { amountMinor: number | null };
  }[];
};
export type ControlViewActor = {
  user: { id: string; name: string | null };
  membership: { role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST"; viaSuperAdmin?: boolean };
  workspace: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    timezone: string;
  };
};
export type ControlsView = {
  actor: ControlViewActor;
  section: Section;
  data: ControlList;
  p: ControlPickers;
  summary: ControlSummary;
  editing: EditableControl | undefined;
  newKind: string | undefined;
  edit: string | undefined;
  today: string;
};
