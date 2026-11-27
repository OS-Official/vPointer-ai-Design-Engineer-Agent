---
name: clean-code
description: Clean, error-free frontend code for HTML, CSS, Tailwind, JavaScript, React, Redux Toolkit and Next.js. Covers structure, naming, state, error and empty states, accessibility basics, security in the browser, and the checks to run before calling work done. Load it before writing, changing or reviewing any front-end code.
---
# Clean frontend code that doesn't break

The user is a designer learning to code. Code they receive becomes code they learn from, so it has to be correct, plain and consistent, and each change has to be explained. "Clever" code that needs explaining is a cost, not a skill.

## 1. Before writing

- **Read first.** Open the files you'll touch and their neighbours, then match their conventions: naming, file layout, CSS approach, import style. A second style in the same project is a bug waiting to happen.
- **Smallest change that solves it.** Don't refactor, rename or "tidy" beyond the task unless asked. If something nearby is broken, mention it.
- **JavaScript, not TypeScript**, unless the project already uses TS. Use ES modules and `const` by default (`let` only when you reassign; never `var`).
- **No new dependency** unless it clearly earns its place (security, correctness or a lot of code saved). Say why when you add one, and pin it in `package.json`.

## 2. Structure and naming

- One component or module does one job. Split at around 150 lines, or as soon as a part has its own name ("PriceRow", "useModelFilter").
- Names say what a thing *is* or *does*: `isMenuOpen`, `selectedModel`, `formatCapacity()`, `handleSubmit`. Don't use `data2`, `temp` or `doStuff`. Booleans read as questions (`is`, `has`, `can`).
- Components: `PascalCase.jsx`. Hooks: `useThing.js`. Utilities: `camelCase.js`. Keep a component, its styles and its test together in one folder when the project does that.
- No magic numbers or strings. Design values come from tokens (`brand_css`). Behaviour constants get a named `const` at the top (`const MAX_LABEL_LENGTH = 12`).
- Delete dead code, commented-out blocks, `console.log` and `debugger` before you finish. Comments explain *why*, never *what*.

## 3. HTML and accessibility basics

- Semantic elements first: `header nav main section article aside footer`, one `<h1>`, and headings in order with no skipped levels.
- `<button>` for actions, `<a href>` for navigation. Never put a click handler on a `div`.
- Every input has a `<label>`, every image an `alt`, every icon-only button an accessible name, and every page `lang` (plus `dir` for Arabic).
- ARIA only where no native element fits, and never contradicting one. `role="button"` on a `<button>` is noise.

## 4. CSS and Tailwind

- Tokens only: no hex values, font names, radii or shadows typed by hand (`brand_lint` checks this).
- Keep specificity low: classes, not IDs; no `!important` except in the reduced-motion reset. Use logical properties for RTL.
- Tailwind: utilities in the markup. When the same long class list repeats, make a **component**, not an `@apply` class. Keep class order consistent (layout → box → type → colour → state); if the project uses the Prettier Tailwind plugin, let it decide.
- Never remove focus outlines without a visible `:focus-visible` replacement.

## 5. JavaScript

- Use strict equality (`===`), early returns over nested `if`s, and pure functions for anything that calculates.
- Every `async` path handles failure: `try/catch` (or `.catch`), and the user sees a useful message instead of a blank screen. Never swallow errors silently.
- Validate at the edges (form input, URL params, API responses). Inside, trust the shape you validated.
- Guard against `null` and `undefined` where data can be missing: optional chaining `?.`, defaults `??`.
- No global mutable state. No `innerHTML` with anything that came from a user or an API; use `textContent`, or let React render it.

## 6. React

`references/react-redux.md` has worked examples.
- Function components and hooks only.
- **State:** keep the minimum, and derive the rest. If a value can be computed from props or state, compute it during render and don't store it. Lift state to the closest shared parent. Reach for context or Redux only when more than two levels need it.
- **Effects** are only for syncing with something outside React (subscriptions, timers, the DOM, fetching when no data library is used). Every subscription or timer has a cleanup function. If an effect only sets state from other state, delete it and derive the value instead.
- **Lists** need stable, unique `key`s from the data (`id`, `slug`). Never use the array index for a list that can reorder, filter or grow.
- **Forms:** controlled inputs, `onSubmit` on the `<form>` (so Enter works) and `event.preventDefault()`.
- **Every data view has four states:** loading, error, empty and success. Design and code all four. Missing empty and error states are the most common bug in a handoff.
- Next.js: Server Components by default, `'use client'` only on the parts that need interactivity, and `next/image` and `next/link`. Secrets only on the server.

## 7. Redux (Redux Toolkit only)

- Use `configureStore` and `createSlice`, never hand-written action types or `switch` reducers. Server data goes through **RTK Query** (`createApi`), not hand-rolled fetch thunks.
- The store holds shared, long-lived app state: the selected model, filters, the cart, the session. Form drafts, open/closed menus and hover state stay local in `useState`.
- State is serialisable (no class instances, functions or Promises) and normalised (`createEntityAdapter` for collections).
- Components read with **selectors** (`useSelector(selectVisibleModels)`), with memoised selectors (`createSelector`) for derived lists. Mutating syntax only inside `createSlice` reducers, where Immer makes it safe.
- Wrap the app in `<Provider>` once, at the root.

## 8. Security in the browser

- Never put secrets in client code or `NEXT_PUBLIC_*` variables. Supabase: only the anon key in the browser, with RLS on.
- No `dangerouslySetInnerHTML` with untrusted content. If HTML must render, sanitise it (DOMPurify) and say why.
- External links with `target="_blank"` get `rel="noopener noreferrer"`.

## 9. Definition of done

Run what exists, fix what fails, and report what you ran:
1. Build or dev server compiles with no errors, and the browser console is clean (no React key or hydration warnings).
2. Lint and format scripts in `package.json` (`npm run lint`, `prettier --check`) pass, and tests pass if there are any.
3. Standards tools: `layout_lint` (responsive and code smells) and, when there's a brand, `brand_lint`. Every *error* finding is fixed; each *warning* is fixed or explained.
4. Loading, error and empty states exist for every data view. Keyboard works. Focus is visible.
5. Report: files changed, what you ran and its result, and 2–4 short bullets on the concept behind the change, so the user learns the pattern. If you couldn't run something, say so plainly instead of implying it passed.
