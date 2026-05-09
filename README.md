# Plasmid Studio

Plasmid Studio is a browser-based circular plasmid map editor for making clean,
exportable plasmid diagrams.

The app lets you paste or edit a plasmid sequence, add annotated features by
base-pair position or sequence search, style the map, and export the result as
an SVG.

## Features

- Circular plasmid map rendering with configurable backbone radius, thickness,
  rotation, background, and typography.
- Feature annotations with arrows, blocks, or line segments.
- Annotation lookup by explicit start/end position or by sequence match,
  including reverse-complement matching.
- Multi-ring layouts with per-feature color, outline, thickness, label
  position, and label visibility controls.
- Translucent highlight regions with curved labels and optional boundary
  markers.
- SVG export for publication figures, slides, and design notes.

> [!tip]
Launch plasmid.studio:
<a href="https://prion-1.github.io/Plasmid-Studio/">
  <img src="https://img.shields.io/badge/>-LAUNCH-2ea44f?style=for-the-badge" alt="Launch">
</a>

## Development

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Build the production site:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

This repo is configured for GitHub Pages at:

```text
https://prion-1.github.io/Plasmid-Studio/
```

The Vite base path is set in `vite.config.js`, and `.github/workflows/deploy.yml`
builds `dist/` and publishes it with GitHub Pages Actions.

## License

Plasmid Studio is licensed under the GNU General Public License v3.0. See
`LICENSE` for the full license text.
