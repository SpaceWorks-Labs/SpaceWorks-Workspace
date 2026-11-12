"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

export function FinanceTabs({ base, canManage, canView = true, payroll = false }: { base: string; canManage: boolean; canView?: boolean; payroll?: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: base, label: "Overview", active: pathname === base },
    { href: `${base}/ledger`, label: "Ledger", active: pathname.startsWith(`${base}/ledger`) },
    { href: `${base}/invoices`, label: "Invoices", active: pathname.startsWith(`${base}/invoices`) },
    { href: `${base}/funds`, label: "Funds", active: pathname.startsWith(`${base}/funds`) },
    { href: `${base}/budgets`, label: "Budgets", active: pathname.startsWith(`${base}/budgets`) },
    ...(canManage ? [{href:`${base}/recurring`,label:"Recurring costs",active:pathname.startsWith(`${base}/recurring`)},{href:`${base}/dues`,label:"Upcoming dues",active:pathname===`${base}/dues`}] : []),
    { href: `${base}/bills`, label: "Bills", active: pathname.startsWith(`${base}/bills`) },
    { href: `${base}/disbursements`, label: "Disbursements", active: pathname.startsWith(`${base}/disbursements`) },
    { href: `${base}/spending`, label: "Spending", active: pathname.startsWith(`${base}/spending`) },
    { href: `${base}/close`, label: "Month-end", active: pathname.startsWith(`${base}/close`) },
    { href: `${base}/bank`, label: "Bank", active: pathname.startsWith(`${base}/bank`) },
    { href: `${base}/statements`, label: "Statements", active: pathname.startsWith(`${base}/statements`) },
    { href: `${base}/export/accounting`, label: "Export", active: pathname.startsWith(`${base}/export`) },
    { href: `${base}/reports`, label: "Reports and export", active: pathname.startsWith(`${base}/reports`) },
    ...(canManage ? [{ href: `${base.replace(/\/finance$/, "")}/money-controls/cash`, label: "Money controls", active: pathname.includes("/money-controls/") }] : []),
    ...(canManage ? [{ href: `${base}/receipt`, label: "Add an entry", active: pathname.startsWith(`${base}/receipt`) }] : []),
    ...(canManage ? [{ href: `${base}/categories`, label: "Categories", active: pathname.startsWith(`${base}/categories`) }] : []),
  ];
  const visible = [...(canView ? items : []), ...(payroll ? [{ href: `${base}/payroll`, label: "Payroll", active: pathname.startsWith(`${base}/payroll`) }] : [])];
  return <NavTabs items={visible} label="Finance sections" />;
}
