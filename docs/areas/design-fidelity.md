# Design fidelity

Cross-cutting presentation pass. See [the rule and area audit](../design-audit.md) for scope, verification and owner items, and [the implementation guide](../DESIGN.md) for component usage.

Canonical colours are pinned from Space Works Design in `app/styles/palette.css` and adapted through the existing `--yy-*` API. Shared primitives retain their public APIs. Layouts contain no data or access logic; callers resolve authorised data in page loaders before JSX.

Patch uses supplied static product assets with theme-aware artwork, built-in clear space and reduced-motion stills. `idle` stays still; route loading states use the Design System 0.12.0 box loader (`LogoLoader` with visible status text, or the static skeleton layouts with the box loader); `sneeze` is used only for the closed poll with quorum. No poll mutations, data models or storage behaviour changed.

The approval inbox and repository list render page-provided data. Their guarded loaders run in the calling pages before JSX. The design-fidelity unit test protects this boundary, palette parity, contrast, logo size/clear space, assets, icon imports, accessible button names, table adoption, font use, flat cards, progress copy and internal emphasis restrictions. No new seed records or external service integrations were introduced.
