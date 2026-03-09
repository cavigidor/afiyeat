

# Fix Sitemap Domain Mismatch

## Problem
The sitemap uses `https://afiyeat.lovable.app/` URLs but Google Search Console is set up for `https://afiyeat.com/`. This causes the "URL not allowed" error.

## Fix
Update `public/sitemap.xml` to use `https://afiyeat.com/` for all URLs.

