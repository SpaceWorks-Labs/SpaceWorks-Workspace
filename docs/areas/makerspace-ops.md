# Makerspace operations

Machine downtime, maintenance reminders, required inductions and consumables stock.
Code: `lib/makerspace/**`, `lib/scheduled/makerspace.ts`, `app/actions/{makerspace,stock}.ts`,
`components/assets/ops/**`, `components/stock/**`, `/w/<slug>/stock`. Module key: `services`.

## Roles
- View (assets page additions, stock list, CSV): MEMBER. Costs (unit cost, cost report, cost CSV columns): ADMIN.
- Manage (downtime, inductions, stock items and movements): ADMIN (`canManageAssets`).
- "Post purchase to ledger" additionally needs `canManageFinance`; it is optional per receipt.

## Downtime
`AssetDowntime` rows (`to` null while open). Status is derived from the open row; `Asset.status` is untouched
so disposal rules in `lib/assets/service.ts` keep working. Overlapping periods are rejected under the asset row lock.
Starting downtime that is already in effect dispatches `asset.downtime_started` (dedupe `downtime:<id>`) to admins.
The report (`downtimeCostReport`) sums hours clipped to the period plus `AssetMaintenanceLog.costMinor`;
the maintenance form now takes an optional cost.

## Maintenance reminders
Hourly job `lib/scheduled/makerspace.ts` calls `runMaintenanceReminders`: every log with `nextDueAt` overdue or within
7 days (`REMINDER_WINDOW_DAYS`) dispatches `asset.maintenance_due` once. Dedupe key `maintenance:<logId>` lives on the
notification event record and is checked under an advisory lock. A later SERVICE or INSPECTION on the same asset closes
an older due date; retired assets and workspaces with `services` off are skipped.

## Required inductions
`AssetCertRequirement` links an asset to `CertType`s. `signoffStatus` (pure, `certStatus.ts`) gives valid, expiring
(30 days), expired or missing; revoked grants are ignored, the latest expiry wins. Admins see everyone
(active non-guests); other members see only their own row.

## Stock
`StockItem.onHand` (Decimal 12,3) changes only through `applyMovement`, which locks the item row. RECEIVE adds, ISSUE and
SALE remove, ADJUST is a signed delta; stock cannot go negative. `stock.reorder` fires when a change moves an item from
above its reorder level to at or below it (also when the level is raised), so it fires once and re-arms on restock.
Dedupe keys are per movement. CSV export (`/stock/export`) uses the shared neutralising `csvCell`.

## Known limits
- Reminder window is a constant, not a per-workspace setting.
- Stock pages show the first 200 items; use search to narrow.
