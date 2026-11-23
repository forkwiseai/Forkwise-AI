---
name: commercial-website
title: Complete commercial website
category: Build
description: Deliver a finished, sellable website (company, shop, agency, clinic, restaurant, SaaS) with every page built, real content, working navigation, forms and SEO. Use when the user asks for a website, especially "complete", "professional" or a number of pages.
---
# Complete commercial website

The bar: a client could publish it today. Every page exists, every link works, every text is real and
specific to this business, it looks designed (not a template), and it works on a phone.
A home page plus a few stubs is not a website.

## 1. Scope first (one todo per page)
Write the sitemap with `todo_write` before any code: one item per page, plus items for shared parts,
content, SEO and the final check. If the user named a number of pages, build exactly that many or more.
If not, use the set that fits the business. A typical 20-page set:

| Group | Pages |
| --- | --- |
| Core | Home, About, Team, Contact, FAQ |
| Offer | Services (or Products) overview, 3–5 service/product detail pages, Pricing |
| Trust | Case studies / Portfolio, one case study detail, Testimonials |
| Content | Blog list, 2 blog posts |
| Action | Book / Get a quote (form), Careers, Thank-you page |
| Legal & system | Privacy policy, Terms, 404 |

Shops: add catalogue, category, product detail, cart, checkout, order confirmation, account.
Persian or Arabic sites: `dir="rtl"`, `lang="fa"`, Vazirmatn font, Persian digits where natural, Jalali dates if dates show.

## 2. Structure
- A real project: Vite + React + React Router (or Next.js), `src/pages/` with one file per page,
  `src/components/` (Header, Footer, Hero, Section, Card, CTA, Form fields), `src/data/` for content
  (services, team, posts, FAQs as arrays) so pages are generated from data, not copy-pasted.
- One design system in CSS variables: colours, type scale, spacing, radius, shadows. Pick a direction
  that fits the brand (load `frontend-design`).
- Header with all main pages (dropdown or mobile menu), footer with every page incl. legal.

## 3. Content (the part most agents skip)
- Write real copy for this business: headline with a benefit, specific services, prices or price ranges,
  process steps, FAQs with real answers, team members with roles, testimonials marked as samples if invented.
- No lorem ipsum, no "coming soon", no TODO, no `href="#"`. The finish check rejects them.
- Images: the user's photos first; otherwise `generate_image` with one consistent style, saved to
  `public/images/`, with alt text. Never leave empty boxes.
- Forms validate, show a success state and go somewhere (an API route, a mailto, or a thank-you page).

## 4. SEO and polish
- Unique `<title>` and meta description per page, Open Graph tags, favicon, `sitemap.xml`, `robots.txt`.
- Semantic headings (one h1 per page), fast images (width/height, lazy), focus styles, contrast.
- Scroll to top on route change, active nav link, 404 route.

## 5. Verify every page
1. `npm run build` passes with no errors.
2. Start it and open **every** route with `screenshot` (desktop 1280 and phone 390). Fix anything broken,
   cramped, overflowing or empty.
3. Click through the nav and footer: every link lands on a real page.
4. Tick each page's todo only after you looked at it.
5. README: what it is, pages list, how to run, build and deploy, where to edit content (`src/data`).

## 6. Hand-over
Tell the user the page list, the preview link, what content is sample (to replace) and what to do to publish.
