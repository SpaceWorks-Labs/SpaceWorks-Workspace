import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import tokens from "../fixtures/design-tokens.json";
import { Patch } from "@/components/brand/Patch";
import { LogoLoader } from "@/components/brand/LogoLoader";
import { BoxSpinner } from "@/components/brand/BoxSpinner";
import { SpaceWorksLogo, spaceWorksLogoSize, spaceWorksLogoSrc } from "@/components/brand/SpaceWorksLogo";
import { Button, IconButton } from "@/components/ui/button";
import { Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { DashboardLayout, SettingsLayout } from "@/components/ui/layouts";
import { Dropdown, Field } from "@/components/ui/field";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const files = ["app", "components"].flatMap(walk).filter(f => /\.(tsx?|css)$/.test(f));
const componentNameCopy = /\b(?:Undo2|Redo2|Columns3|Code Xml|Image Plus|Send Horizontal|[A-Z][a-z]+(?:[A-Z][a-z]*)*\d+[A-Za-z\d]*)\b/;
const findComponentNameCopy = (file: string, text: string) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const check = (node: ts.Node, copy: string) => {
    const match = copy.match(componentNameCopy);
    if (match) violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${match[0]}`);
  };
  const expressionCopy = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) check(node, node.text);
    ts.forEachChild(node, expressionCopy);
  };
  const visit = (node: ts.Node) => {
    // aria-hidden hides copy from assistive technology, not from sighted users.
    if (ts.isJsxText(node)) check(node, node.text);
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) expressionCopy(node);
    if (ts.isJsxAttribute(node) && ["label", "children"].includes(node.name.getText(source)) && node.initializer) expressionCopy(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
};
const render = (component: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(component);
const declarations = (text: string) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
const palette = read("app/styles/palette.css");
const blocks = [...palette.matchAll(/\{([^{}]+)\}/g)].map(m => declarations(m[1]));
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const contrast = (a: string, b: string) => {
  const luminance = (hex: string) => rgb(hex).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
};

describe("design token contract", () => {
  it.each(["light", "dark"] as const)("matches every canonical %s sRGB token", mode => {
    const block = blocks[mode === "light" ? 0 : 1];
    expect(Object.keys(block).filter(k => k.startsWith("--sw-color-"))).toHaveLength(Object.keys(tokens[mode]).length);
    for (const [name, value] of Object.entries(tokens[mode])) expect(block[`--sw-color-${name}`], name).toBe(rgb(value).join(" "));
  });
  it("keeps explicit dark, dark bands and the OS fallback identical", () => {
    expect(blocks[1]).toEqual(blocks[2]);
    expect(palette).toContain('.yy-dark-band');
    const adapters = read("app/styles/tokens.css");
    const modes = [...adapters.matchAll(/\{([^{}]+)\}/g)].map(m => declarations(m[1])).filter(v => v["--yy-bg-canvas"]);
    expect(modes[1]).toEqual(modes[2]);
    expect(adapters).toContain("--yy-shadow-raised: none;");
  });
  it.each(["light", "dark"] as const)("keeps every %s chart series at 3:1 on the page and panels", mode => {
    expect(Object.keys(tokens.chart[mode])).toEqual(tokens.chart.order);
    for (const series of tokens.chart.order) for (const bg of ["bg", "panel", "surface"] as const) {
      expect(contrast(tokens.chart[mode][series as keyof typeof tokens.chart.light], tokens[mode][bg]), `${mode} ${series} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
  it.each(["light", "dark"] as const)("keeps text and action labels readable in %s", mode => {
    const p = tokens[mode];
    expect(contrast(p["accent-ink"], p.line), `${mode} progress mark on track`).toBeGreaterThanOrEqual(3);
    for (const text of ["ink", "muted", "accent-ink", "success-ink", "warn-ink", "info-ink", "danger"] as const) {
      for (const bg of ["bg", "surface", "panel", "hover", "accent-soft", "success-soft", "warn-soft", "info-soft", "emphasis-soft"] as const) {
        expect(contrast(p[text], p[bg]), `${mode} ${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const tone of ["accent", "brand", "emphasis", "success", "warn", "info", "danger"] as const) {
      for (const suffix of ["", "-hover", "-active"]) expect(contrast(p[`on-${tone}`], p[`${tone}${suffix}` as keyof typeof p])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("brand and accessible primitives", () => {
  it.each([undefined, "project-filter"])("associates a Dropdown label with the visible trigger (id: %s)", id => {
    const html = render(createElement(Field, {
      label: "Project",
      id,
      helperText: "Choose a project.",
    } as Parameters<typeof Field>[0], createElement(Dropdown, { name: "project" }, createElement("option", { value: "" }, "All projects"))));
    const controlId = html.match(/<label\b[^>]* for="([^"]+)"/)?.[1];
    expect(controlId).toBeTruthy();
    if (id) expect(controlId).toBe(id);
    const trigger = html.match(/<button\b[^>]*>/)?.[0];
    expect(trigger).toContain(`id="${controlId}"`);
    expect(trigger).toContain('role="combobox"');
    expect(trigger).toContain(`aria-describedby="${controlId}-description"`);
    const nativeSelect = html.match(/<select\b[^>]*>/)?.[0];
    expect(nativeSelect).toContain('aria-hidden="true"');
    expect(nativeSelect).not.toMatch(/\bid=/);
  });
  it("clamps logos to the actual artwork minima and includes clear space", () => {
    expect(spaceWorksLogoSize("symbol", 1).height).toBeGreaterThanOrEqual(48);
    expect(spaceWorksLogoSize("lockup-horizontal", 1).height).toBeGreaterThanOrEqual(48);
    expect(spaceWorksLogoSize("lockup-stacked", 1).width).toBeGreaterThanOrEqual(180);
    expect(render(createElement(SpaceWorksLogo, { variant: "symbol" }))).toContain("padding:12px");
    for (const variant of ["symbol", "lockup-horizontal", "lockup-stacked"] as const) for (const tone of ["full", "ink", "reversed"] as const) expect(existsSync(path.join(process.cwd(), "public", spaceWorksLogoSrc(variant, tone)))).toBe(true);
  });
  it("uses still Patch for empty states and the approved adaptive art for collective success", () => {
    const idle = render(createElement(EmptyState, { patch: true, title: "No projects yet." }));
    expect(idle).toContain('data-patch="idle"');
    expect(idle).not.toContain('src="/brand/mascot/patch-animated.webp"');
    const success = render(createElement(Patch, { pose: "sneeze", size: 112 }));
    expect(success).toContain("/brand/mascot/dark/patch-animated.webp");
    expect(success).toContain("prefers-reduced-motion: reduce");
    expect(success).toContain("padding:28px");
    const assetNames = [...success.matchAll(/(?:src|srcSet)="([^\"]+)"/g)].map(m => m[1]);
    for (const asset of assetNames) expect(existsSync(path.join(process.cwd(), "public", asset))).toBe(true);
  });
  it("uses the box-open loader for every loading state and no ring spinners", () => {
    const loading = render(createElement(LogoLoader, { label: "Loading projects", showLabel: true }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain("sw-box loop");
    expect(loading).toContain("Loading projects</p>");
    expect(render(createElement(BoxSpinner, { label: "Uploading", mono: true }))).toMatch(/aria-label="Uploading".*"sw-box loop [^"]*mono"/);
    expect(render(createElement(Button, { loading: true, loadingLabel: "Saving" }, "Save"))).toMatch(/aria-busy="true".*"sw-box loop [^"]*mono".*Saving/);
    for (const file of files.filter(f => f.endsWith("/loading.tsx"))) expect(read(file), file).toMatch(/LogoLoader|@\/components\/ui\/skeletons/);
    for (const file of files.filter(f => f.endsWith(".tsx"))) expect(read(file), file).not.toMatch(/\banimate-spin\b|components\/ui\/spinner|BrandLoader/);
  });
  it("names icon buttons and keeps all sizes at least 44px", () => {
    const html = render(createElement(IconButton, { label: "Close", size: "sm" }, "×"));
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('size-11');
    for (const size of ["sm", "md", "lg"] as const) expect(render(createElement(Button, { size }, "Save"))).toMatch(/min-h-(11|12)/);
  });
  it("renders a word with every status and a 260px dashboard rail", () => {
    expect(render(Chip({ tone: "success", children: "Closed" }))).toContain("Closed");
    expect(render(DashboardLayout({ rail: "Recent activity", children: "Tasks" }))).toContain("_260px]");
  });
  it("keeps one page heading when a settings section has its own title", () => {
    const html = render(SettingsLayout({ header: PageHeader({ title: "Settings" }), children: PageHeader({ title: "Notification routing", titleAs: "h2" }) }));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("<h2");
  });
});

describe("design source guards across every area", () => {
  it.each(["Undo2", "Redo2", "Columns3", "Code Xml", "Image Plus", "Send Horizontal", "Heading4", "ArrowUp2"])("detects component-name copy: %s", copy => {
    for (const jsx of [`<span aria-hidden="true">${copy}</span>`, `<button>{"${copy}"}</button>`, `<ToolButton label="${copy}" />`]) {
      expect(findComponentNameCopy("example.tsx", jsx)).not.toEqual([]);
    }
  });
  it("allows short UI words and formatting glyphs without confusing imports or attributes for copy", () => {
    expect(findComponentNameCopy("example.tsx", 'import { Undo2 } from "lucide-react"; const ui = <button id="Undo2"><Undo2 />Send Undo Redo Columns Code Image Attach × ✓ → ← B I S H2 H3 #</button>;')).toEqual([]);
  });
  it("never renders lucide component names as UI copy", () => {
    expect(files.filter(file => file.endsWith(".tsx")).flatMap(file => findComponentNameCopy(file, read(file)))).toEqual([]);
  }, 30_000);
  it("keeps inbox and repository reads in page-local sections under Suspense", () => {
    for (const component of ["components/requests/ApprovalInbox.tsx", "components/integrations/GithubPullRequests.tsx"]) {
      expect(read(component)).not.toMatch(/from ["']@\/lib\/(?:db|views\/)/);
      expect(read(component)).not.toContain("export async function");
    }
    const templates = JSON.parse(read("frontend/pages.json")) as Array<{ file: string; source: string }>;
    for (const [file, reader, section, fallback] of [
      ["app/w/[workspaceSlug]/requests/page.tsx", "loadApprovalInbox", "InboxSection", "Loading approvals"],
      ["app/w/[workspaceSlug]/requests/approvals/page.tsx", "loadApprovalInbox", "InboxSection", "Loading approvals"],
      ["app/w/[workspaceSlug]/projects/[key]/(project)/overview/page.tsx", "loadGithubPullRequests", "PullRequestsSection", "Loading pull requests and issues…"],
    ]) {
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const page = source.statements.filter(ts.isFunctionDeclaration).find(f => f.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
      const statements = [...(page?.body?.statements ?? [])];
      const helper = source.statements.filter(ts.isFunctionDeclaration).find(f => f.name?.text === section);
      if (!helper) throw new Error(`Missing streamed section in ${file}`);
      expect(helper.name?.text, file).toBe(section);
      expect(helper.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword), file).toBe(true);
      expect(helper.body?.getText(source), file).toContain(`await ${reader}(`);
      // Awaiting in the page itself would block local data and its generated backend loader.
      expect(page?.body?.getText(source), file).not.toContain(`await ${reader}(`);
      const props = section === "PullRequestsSection" ? "workspaceSlug={workspaceSlug} projectId={projectId}" : "workspaceSlug={workspaceSlug}";
      const boundary = `<Suspense fallback={<p role="status">${fallback}</p>}><${section} ${props} /></Suspense>`;
      expect(statements.find(ts.isReturnStatement)?.getText(source), file).toContain(boundary);
      expect(templates.find(t => t.file === file)?.source, file).toContain(boundary);
      const slug = file.replace(/^app\//, "").replace(/\.tsx$/, "").replace(/[^a-zA-Z0-9]+/g, "-");
      const loader = read(`lib/views/generated/${slug}-load${page?.name?.text}.ts`);
      expect(loader, file).not.toContain(reader);
      expect(loader, file).not.toContain(section);
    }
  });
  it("uses tokens, the brand type scale and flat cards", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (!file.startsWith("components/")) continue;
      const s = read(file);
      for (const pattern of [/#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])/i, /\bfont-mono\b/, /\btext-\[\d+px\]/, /\btext-[\w-]+\/\d+/, /\bbg-(?:primary|accent|highlight|success|warning|info|danger)\/\d+/, /\btext-(?:highlight|sw-orange|primary)(?![\w-])/, /\bshadow-(?:sm|md|lg|xl|2xl)\b/, /hover:(?:-?translate|scale|shadow)/, /\b(?:Oops|Something went wrong|asset ecosystem)\b/i]) if (pattern.test(s)) violations.push(`${file}: ${pattern}`);
    }
    expect(violations).toEqual([]);
  });
  it("keeps app buttons calm, sidebar text-only, and theme choices light/dark", () => {
    expect(read("components/chrome/SidebarNav.tsx")).toContain("bg-sidebar-active");
    expect(read("components/chrome/SidebarNav.tsx").split("function NavLink")[1].split("const listeners")[0]).not.toMatch(/<svg|Icon\s*\//);
    expect(read("components/account/AppearanceCard.tsx")).not.toMatch(/value: "system"|Match device/);
    for (const file of files.filter(f => f.endsWith(".tsx"))) {
      if (file === "components/ui/button.tsx") continue;
      expect(read(file), file).not.toMatch(/variant=["']highlight["']/);
      expect(read(file), file).not.toContain("font-accent");
      // Preserve the existing accessible GitHub streaming fallback requested in review.
      const copy = file === "app/w/[workspaceSlug]/projects/[key]/(project)/overview/page.tsx"
        ? read(file).replace('role="status">Loading pull requests and issues…</p>', 'role="status">Loading pull requests and issues</p>')
        : read(file);
      expect(copy, file).not.toMatch(/\b(?:Saving|Loading|Adding|Creating|Working|Thinking|Fetching|Syncing|Checking|Verifying|Publishing|Opening|Sending|Deleting|Uploading|Moving|Updating|Importing|Exporting|Freezing|Linking|Testing|Searching|Retrying|typing|thinking|Sharing)\b[^…\n"'`<>]{0,100}…/);
      if (!["components/ui/button.tsx", "components/ui/display.tsx"].includes(file)) expect(read(file), file).not.toMatch(/\bbg-highlight(?:-soft)?\b|tone=["']highlight["']/);
    }
  });
  it("routes authored data tables through the bordered table primitive", () => {
    const raw = files.filter(f => f.endsWith(".tsx") && f !== "components/ui/table.tsx" && /<table\b/.test(read(f)));
    expect(raw).toEqual([]);
  });
  it("names icon-only buttons and limits literal header primary actions", () => {
    const violations: string[] = [];
    for (const file of files.filter(f => f.endsWith(".tsx"))) {
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const icons = new Set<string>();
      const approved = new Set(["Archive", "Cpu", "MapPin", "Search", "Plus", "ArrowLeft", "ArrowUpRight", "ChevronsUpDown", "Info", "TriangleAlert", "CircleCheck", "Ellipsis", "Sun", "Moon", "LogOut", "Bug", "Sparkles", "FileText", "Wrench", "Flag", "Lightbulb", "Inbox", "Bell"]);
      for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "lucide-react") {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const icon of bindings.elements) {
          icons.add(icon.name.text);
          if (!statement.importClause?.isTypeOnly && !icon.isTypeOnly && !approved.has((icon.propertyName ?? icon.name).text)) violations.push(`${file}: unapproved icon ${(icon.propertyName ?? icon.name).text}`);
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node)) {
          const tag = node.openingElement.tagName.getText(source);
          const attrs = node.openingElement.attributes.properties.filter(ts.isJsxAttribute);
          if (["button", "Button"].includes(tag) && !attrs.some(a => ["aria-label", "aria-labelledby", "title"].includes(a.name.getText(source)))) {
            const children = node.children.filter(c => !(ts.isJsxText(c) && !c.text.trim()) && !(ts.isJsxExpression(c) && !c.expression));
            if (children.length && children.every(c => ts.isJsxSelfClosingElement(c) && icons.has(c.tagName.getText(source)))) violations.push(`${file}: unnamed icon button`);
          }
        }
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "PageHeader") {
          const action = node.attributes.properties.filter(ts.isJsxAttribute).find(a => a.name.getText(source) === "actions");
          if (action?.initializer) {
            let primaries = 0;
            const count = (n: ts.Node) => {
              if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(source) === "Button" && n.attributes.properties.filter(ts.isJsxAttribute).some(a => a.name.getText(source) === "variant" && a.initializer && ["\"primary\"", "\"accent\""].includes(a.initializer.getText(source)))) primaries += 1;
              ts.forEachChild(n, count);
            };
            count(action.initializer);
            if (primaries > 1) violations.push(`${file}: multiple primary actions in a page header`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  }, 30_000);
});
