# Accessibility Baseline — audited 2026-08-31 (Backlog #108 / SITE-074)

Scope: storefront (customer-facing). The admin SPA is used by two known
admins and got a lighter pass. Method: markup/CSS inspection of the
generated pages and source, plus computed WCAG 2.1 contrast ratios for the
real palette. No customer-reported accessibility issues to date.

## Verified strengths (inspected, not assumed)

| Area | State |
|---|---|
| Form labels | Every input on checkout, account, design-request wrapped in `<label>` or explicitly `for`-linked; file inputs carry `aria-describedby` |
| Images | Every product `<img>` has real alt text (colour/item names); decorative SVGs are `aria-hidden` |
| Skip navigation | "Skip to content" link on all pages, visible on focus, targets `#main` |
| Keyboard focus | Global `:focus-visible` outline (2px terracotta, offset) in `main.css` |
| ARIA usage | 570+ attributes: labelled icon buttons, `aria-expanded`/`aria-controls` on collapsibles, `role="status"`/`aria-live` on toasts and form notes |
| Reduced motion | `prefers-reduced-motion` disables all GSAP/CSS animation AND (since P2) skips downloading the Three.js hero entirely |
| Landmarks | `<main id="main">`, `<nav aria-label>` for breadcrumbs/sidebar/primary on generated pages |
| New features | Search inputs have `aria-label`s; FAQ/DFM use native `<details>` (keyboard-operable for free); restock form uses a real `<form>`/`type="email"` |

## Contrast findings (light theme, computed)

| Pair | Ratio | Verdict |
|---|---|---|
| charcoal `#1a1612` on cream | 16.25 | Pass AAA |
| espresso `#3b322b` on cream (body text) | 11.31 | Pass AAA |
| `text-espresso/70` (≈`#746a5f`) | 4.78 | Pass AA small text |
| green fulfilment labels `#2e6e46` | 5.52 | Pass AA |
| **terracotta `#c24b28` text/links on cream** | **4.38** | **Just under 4.5 AA for small text**; passes for large/bold. Most uses are semibold — borderline |
| **`text-espresso/55` small text** (delivery notes, helper copy) | **3.14** | **Fails AA small text** (passes large only) |
| **`text-espresso/45`** (breadcrumbs, eyebrows, SKU lines) | **2.40** | **Fails AA** — mitigated by being short wayfinding labels, not reading copy |
| Dark theme espresso `#d2c4b5` on dark grounds | 9.79 | Pass |

## Recommended follow-ups (not applied — palette calls are the owner's)

1. Raise the muted-text floor: `/45` → `/60`-ish and `/55` → `/70` for any
   small text that conveys information (delivery notes, stock counts, SKU
   lines). Pure decoration (eyebrows) may stay.
2. Consider a slightly darker terracotta for small-text links only (e.g.
   `#b04322` ≈ 5.0:1) while keeping the brand terracotta for buttons/large
   text — a one-token change in `main.css` if a `--color-terracotta-text`
   is introduced.
3. A real screen-reader pass (NVDA) on checkout end-to-end remains the one
   check inspection can't substitute for.

## Admin notes

Same palette, denser tables; the `/45–/55` findings apply there too.
`confirm()` dialogs (order cancel etc.) are natively accessible. No skip
link (single-view SPA behind auth — acceptable).
