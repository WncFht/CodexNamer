# Claude Design MD Adoption

This project vendors the public `design-md/claude` reference from:

- `https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/claude`

The source files are copied into this directory:

- [README.md](/home/fanghaotian/Desktop/src/codex-session-manager/docs/design/claude/README.md)
- [DESIGN.md](/home/fanghaotian/Desktop/src/codex-session-manager/docs/design/claude/DESIGN.md)
- [preview.html](/home/fanghaotian/Desktop/src/codex-session-manager/docs/design/claude/preview.html)
- [preview-dark.html](/home/fanghaotian/Desktop/src/codex-session-manager/docs/design/claude/preview-dark.html)

## What We Adopt

- Parchment canvas as the default page background
- Serif headlines with warm editorial spacing
- Terracotta accent for primary actions and selected states
- Warm neutral borders, surfaces, and metadata tones
- Ring-shadow based depth instead of cold tech drop shadows
- Large rounded cards for sessions, transcript entries, and settings panels
- Dark left rail plus light reading surface for chapter-like contrast

## Current Mapping

- App shell: dark navigation rail + parchment content surface
- Session cards: ivory cards with warm ring shadows and serif titles
- Detail header: large serif title with subdued metadata line
- Transcript: ivory editorial cards with warm semantic role pills
- Controls: warm sand buttons, terracotta primary emphasis, white search/input fields
- Settings: editorial form layout instead of developer-console styling

## Deliberate Deviations

- We keep transcript tool/system filters and maintenance JSON blocks because this is an operational product, not a marketing page.
- We use Georgia/system fallbacks instead of Anthropic proprietary fonts.
- We keep explicit split panes and data-dense session lists, but style them with Claude-like surfaces and pacing.
