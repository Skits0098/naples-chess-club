#!/usr/bin/env bash
# Point the whole site at your real domain.
#
#   ./set-domain.sh napleschessclub.com
#
# Rewrites the canonical URL, Open Graph tags, structured data,
# sitemap and robots.txt, and writes the CNAME file GitHub Pages needs.

set -euo pipefail

NEW="${1:-}"
if [ -z "$NEW" ]; then
  echo "Usage: ./set-domain.sh yourdomain.com" >&2
  exit 1
fi

# Strip protocol, www and any trailing slash so the input is forgiving.
NEW="${NEW#http://}"; NEW="${NEW#https://}"; NEW="${NEW#www.}"; NEW="${NEW%/}"

cd "$(dirname "$0")"

# Current domain is whatever the canonical tag says.
OLD="$(sed -n 's|.*<link rel="canonical" href="https://\([^/"]*\).*|\1|p' index.html | head -1)"
if [ -z "$OLD" ]; then
  echo "Could not find the current domain in index.html" >&2
  exit 1
fi

if [ "$OLD" = "$NEW" ]; then
  echo "Already set to $NEW — nothing to do."
  exit 0
fi

echo "Rewriting $OLD -> $NEW"
for f in index.html 404.html sitemap.xml robots.txt; do
  [ -f "$f" ] || continue
  sed -i.bak "s|$OLD|$NEW|g" "$f" && rm -f "$f.bak"
  echo "  updated $f"
done

printf '%s\n' "$NEW" > CNAME
echo "  wrote CNAME"

# Blog pages bake the domain into canonicals and structured data, so they
# have to be regenerated. This also rewrites sitemap.xml and feed.xml.
if command -v node >/dev/null 2>&1; then
  echo
  echo "Rebuilding the blog against the new domain:"
  node build-blog.js
else
  echo
  echo "WARNING: node not found — run 'node build-blog.js' yourself to update" >&2
  echo "         the blog pages, sitemap.xml and feed.xml." >&2
fi

echo
echo "Remaining references to the old domain (should be none):"
grep -rln "$OLD" index.html 404.html sitemap.xml feed.xml robots.txt CNAME blog 2>/dev/null || echo "  none"
