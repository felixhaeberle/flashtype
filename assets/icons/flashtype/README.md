# Flashtype Icons

This directory contains the canonical SVG sources for Flashtype icons:

- `favicon.svg` for website favicons
- `app-rounded.svg` for app icons
- `markdown-document.svg` for Markdown document icons

Run `cargo flashtype-icons` from the repository root to regenerate:

- `build/icon.png`
- `build/icon.icns`
- `build/markdown.icns`
- served SVG copies under `public/icons/flashtype/`
- `website/public/favicon.svg`

The Cargo alias uses `cargo-bash` to run `scripts/flashtype-icons.sh`.
The generator uses `resvg` for SVG-to-PNG rendering and macOS `iconutil` for ICNS packing.
