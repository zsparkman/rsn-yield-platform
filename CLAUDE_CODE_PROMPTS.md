# Claude Code Prompts

Use these in **strict sequence**. Don't run them in parallel — each builds on the prior step's output. Open Claude Code in the `rsn-yield-platform/` directory after the spec docs are in place under `docs/spec/`.

Before running Prompt 1, verify these files exist:

```
docs/spec/01-data-model.md
docs/spec/02-information-architecture.md
docs/spec/03-synthetic-data-spec.md
docs/spec/04-client-roster.json
README.md
.gitignore
```

And optionally (for visual reference):

```
docs/reference/01-table-of-contents.png
docs/reference/02-fill-tab.png
docs/reference/03-inventory-tab.png
docs/reference/04-avails-oversell-tab.png
docs/reference/05-rates-tab.png
docs/reference/06-spot-grid-tab.png
docs/reference/07-client-detail-tab.png
docs/reference/08-no-game-tab.png
docs/reference/09-aur-report-tab.png
docs/reference/10-heatmap-tab.png
```

---

## Prompt 1 — Scaffold and data generator

Paste this verbatim into Claude Code:

> Read the four spec documents in `docs/spec/` first, in order: `01-data-model.md`, `02-information-architecture.md`, `03-synthetic-data-spec.md`, `04-client-roster.json`. These are the build contract. Treat them as authoritative; do not deviate from any specified field name, file structure, or calibration target without surfacing the conflict to me first.
>
> Your task in this prompt is **scaffolding and the synthetic data generator only**. Do not build any UI yet.
>
> Steps:
>
> 1. Initialize a Next.js 14+ project in the current directory using App Router, TypeScript, Tailwind, ESLint, and the `src/` directory layout. Run: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"` and accept all defaults otherwise. If the command fails because the directory has files, work around by using `--use-npm` and confirming overwrite.
>
> 2. Configure `next.config.js` for static export (`output: 'export'`).
>
> 3. Install runtime deps: `recharts`, `clsx`, `date-fns`. Install dev deps: `seedrandom`, `@types/seedrandom`, `tsx`.
>
> 4. Create the directory `scripts/generator/` and build the eight generator modules per `docs/spec/03-synthetic-data-spec.md`. They are TypeScript files run via `tsx`. Use `seedrandom` with the seed `'rsn-yield-platform-v1'`, derived per module per the spec.
>
> 5. Create shared TypeScript interfaces in `src/lib/types.ts` matching the schemas in `docs/spec/01-data-model.md` exactly.
>
> 6. Create a top-level orchestrator `scripts/generate-data.ts` that runs all eight modules in order plus the validation step.
>
> 7. Add an `npm run generate-data` script to `package.json` that runs `tsx scripts/generate-data.ts`.
>
> 8. Implement `scripts/generator/99-validate.ts` per the validation targets table in the spec. The script must print every metric and fail the process with a non-zero exit code if any miss.
>
> 9. Run `npm run generate-data` and iterate until all validation targets pass. If a target consistently misses, do not fudge the validator — fix the generator. If you genuinely cannot hit a target after three reasonable attempts, stop and surface the specific issue to me.
>
> 10. Once validation passes, commit with message: `feat: scaffold + synthetic data generator passing validation`.
>
> Do not start building any pages or components in this prompt. Stop after the data generator passes validation.

---

## Prompt 2 — Build the five views (run only after Prompt 1 completes)

Paste this verbatim into Claude Code:

> Read `docs/spec/02-information-architecture.md` again as the build contract for this prompt. Do not deviate from specified layouts, columns, formatting, or filter affordances without surfacing the conflict.
>
> Use the visual reference screenshots in `docs/reference/` for layout fidelity. The synthetic data is in `/data/*.json` and was validated in the prior prompt. Load it into the app via static imports or a typed data loader in `src/lib/data.ts`.
>
> Build the following routes in App Router. Build them **in this order**, one at a time, and verify each renders correctly with the synthetic data before moving to the next:
>
> 1. **Layout shell** — `src/app/layout.tsx` with the persistent top nav per the IA spec. Five view links, season selector (defaults to 2026), About link. Page wrapper with `bg-slate-50`.
>
> 2. **Landing page** — `/` per the IA Landing spec. Three sections: header, view cards grid, footer with sanitization disclosure.
>
> 3. **Inventory view** — `/inventory` per IA View 1 spec. This is the flagship — get this right before moving on. Match number formatting and heat scales exactly.
>
> 4. **Heatmap view** — `/heatmap` per IA View 3 spec. Continuous red gradient.
>
> 5. **Rates view** — `/rates` per IA View 2 spec. Weekly grouping, heat on Open columns.
>
> 6. **Spot Grid view** — `/spot-grid` per IA View 4 spec. Sticky client column, sticky date row, green saturation cells.
>
> 7. **AUR Report view** — `/aur-report` per IA View 5 spec. LOB toggle, monthly subtotals, legend at top.
>
> 8. **About page** — `/about` per IA spec.
>
> Constraints:
>
> - Use Tailwind utility classes only — no custom CSS files beyond the default `globals.css`
> - Use `font-variant-numeric: tabular-nums` on all numeric cells
> - All currency, percent, and EQ30 formatting must match the spec exactly
> - Tables must be functional with the data volumes in `/data/spots.json` (10–14k rows). Use virtualization (react-window or similar) only if a view is genuinely sluggish; otherwise plain tables are fine
> - Dark mode is out of scope. Light mode only
> - Animation is out of scope. Static interactions only
>
> After each view, run `npm run dev` and confirm visually that the view renders. After all views are done, run `npm run build` and confirm static export succeeds with no errors.
>
> Commit after each completed view with messages like `feat: inventory view`.
>
> Stop after the static build succeeds. Do not deploy in this prompt.

---

## Prompt 3 — Polish and deploy (run only after Prompt 2 completes)

Paste this verbatim into Claude Code when ready to deploy:

> Final pass before deploy. Read the IA spec one more time and check each view against it.
>
> 1. Verify the static build (`npm run build`) succeeds and outputs to `out/`.
>
> 2. Open `out/index.html` and the five view pages in a browser via `npx serve out` and confirm:
>    - Navigation works between all routes
>    - All numbers format correctly
>    - All heat scales render correctly
>    - No console errors
>    - Page loads under 3 seconds on a normal connection
>
> 3. Add a `NEXT_PUBLIC_SEED` build env var (default `'rsn-yield-platform-v1'`) so future seed swaps don't require code changes.
>
> 4. Update README with deploy instructions and final structure.
>
> 5. Initialize the git remote (I'll provide the GitHub repo URL when this prompt runs). Push to GitHub.
>
> 6. Output the steps I should run on Vercel to deploy from the GitHub repo. Do not attempt to deploy yourself — I'll do it from the Vercel dashboard.
>
> 7. After my deploy succeeds, help me set up the custom subdomain on `zachsparkman.com` via DNS. Output exact DNS records I need to add at my registrar.

---

## Sanitization audit (run before pushing to GitHub)

Before Prompt 3 pushes anything public, run this grep across the entire repo:

```bash
grep -rEi "spectrum|charter|snla|spsn|lakers|dodgers|\bhts\b|p-08|p-09|p-19|p-80|morongo|t-mobile|verizon|lexus|innocean|keck|hometeam ?sports" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --exclude-dir=out \
  .
```

Any hits — even in code comments — should be swapped or deleted. The spec docs intentionally don't reference any of these terms; if Claude Code introduces them it's a regression worth catching.

---

## If something goes off-rails

Stop the Claude Code session and start a new one. Re-feed it the spec docs and the last passing commit. The deterministic seed means the data is reproducible across sessions.

If you want to swap the seed and see how the data shifts: change `NEXT_PUBLIC_SEED` and rerun `npm run generate-data`. The validation targets are loose enough that most reasonable seeds will pass — but if one doesn't, you've found a brittleness in the generator and that's worth knowing.
