# Working principles

These are the standards the agent holds every piece of work to. **Edit this file to describe yourself and how you work**: the agent reads it at the start of every session. The text below is a sensible starting point.

## Who I am
- A designer / design engineer working across several projects at once.
- Building front ends with HTML, CSS, JavaScript, Tailwind CSS, React and Redux. Prefer **JavaScript over TypeScript** unless a project already uses TypeScript.
- I want to understand the method, not just get the result: explain the *why* briefly after the *what*.

## Design standards
- A project with a brand pack (`**Brand:**` line in its brief) follows that pack exactly: tokens, type, grid, components. Taste notes below never override it.
- Precision first: every value (spacing, colour, type size) comes from a token or a stated scale, never a guess.
- Clean negative space and restraint; brand-designed visuals over stock imagery.
- A system, not a page: icons, wordmarks, colours and type stay consistent across every surface and size.
- Logos and marks must hold up at small sizes (favicon, app icon) and in light and dark.

## Arabic and RTL
- Arabic copy is professional **Modern Standard Arabic (MSA)**: tight, formal, **no diacritics**.
- RTL is handled at the code layer (`dir="rtl"`, logical CSS properties, `next-intl` in Next.js), not by mirroring exported artwork.
- Fonts come from the project's brand: a brand pack (context/brands/) always wins. With no brand fonts recorded, ask rather than pick.

## Engineering standards
The detailed rules live in `standards/` (responsive-grid, clean-code, and a standard per brand such as northwind-brand). In short:
- Semantic HTML, accessible by default (WCAG 2.2 AA minimum: 4.5:1 body text, 3:1 large text and UI parts, visible focus, keyboard reachable).
- Mobile first: the phone layout is the base, and breakpoints add columns (4 / 8 / 12 grid). Logical properties (`margin-inline-start`, not `margin-left`) so LTR/RTL both work.
- Tailwind tokens mirror design-tool variables 1:1.
- Small, readable components. Loading, error and empty states for every data view. No dependency added without a reason.
- Nothing is done until the build, the linters (layout_lint, brand_lint) and the tests pass.

## Security standards
- Secrets live in environment variables only, never in code, design files, or Git.
- Cloudflare (if used): SSL/TLS Full (strict), Always Use HTTPS.
- Security headers on every site: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors.
- Supabase (if used): Row Level Security on every table; the service-role key never reaches the browser.
- WordPress (if used): lean plugin stack, updates on, no nulled plugins, least-privilege client roles.
- Clients get the least access that lets them do their job.

## How I want the agent to work
- Precise and efficient: do the work, then give a short summary of what changed and why.
- Ask only when a decision is expensive to undo or genuinely ambiguous.
- Never deploy, push, publish, or delete without my explicit yes.
