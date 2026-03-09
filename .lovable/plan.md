

# SEO Keyword Optimization Plan

## Problem
The site lacks targeted keywords in its metadata and content, making it hard for search engines to associate it with terms like "restaurant tracker", "recipe site", etc.

## Changes

### 1. Update `index.html` meta tags
- Add keyword-rich `<title>`: "Afiyeat - Restaurant Tracker & Recipe Sharing App | Track Your Favorite Food Spots"
- Update `meta description` to include target keywords naturally: "Track restaurants you want to visit, save places you've been, share recipes, and discover new food spots with friends. Free restaurant tracker and recipe sharing app."
- Add `<meta name="keywords">` with relevant terms
- Update OG title/description to match

### 2. Update landing page (`src/pages/Index.tsx`) content
- Add keyword-rich headings and body text that search engines can crawl (e.g., "Restaurant Tracker", "Recipe Sharing", "Food Journal")
- Add a short "What is Afiyeat?" section with natural keyword usage
- Update feature descriptions to include searchable phrases

### 3. Add `public/sitemap.xml`
- Include all public routes (`/`, `/auth`, `/terms`, `/privacy`) so Google can discover and index pages

### 4. Add structured data (JSON-LD)
- Add `WebApplication` schema markup in `index.html` so Google understands what the site is

## Target Keywords
- restaurant tracker
- recipe sharing app
- food journal
- track restaurants
- save restaurants
- share recipes with friends
- food adventure app

