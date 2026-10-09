# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, and optional professional audio work.

## Build 0.5.0

Build 0.5.0 corrects the Primary trim and Source-selection workflow.

- Primary brackets are now identified as Trim Start and Trim End.
- Each Primary editor contains Apply Primary Trim, which confirms the start, end, and resulting duration.
- Source brackets are now identified as Selection Start and Selection End.
- Every Source editor contains Insert Selection at Primary Playhead and Add Selection to End.
- Ctrl+Enter inserts the active Source selection at the remembered Primary playhead.
- Ctrl+Shift+Enter adds the active Source selection to the end.
- The Primary playhead remains remembered while a Source selection is prepared.
- Primary and Source lists no longer use long aria-describedby text that JAWS repeated during list navigation.
- Native video controls are removed from the accessibility tree. The editor's consistent custom player, slider, and keyboard controls remain available.
- Routine loading and transport announcements no longer repeat filenames.
- Unsupported preview formats no longer expose working-looking controls. The editor announces that conversion is required.

The first opened file becomes Primary Media. Additional files become Source Media and are excluded from output until inserted. Every supported video or audio item has a titled editor section containing its own preview player, playhead slider, position, marks, track target, and editing controls.

All operations are nondestructive. Source files are not modified.

## Current format limitation

WMV cannot be decoded by the current WebView2 preview engine. Build 0.5.0 identifies this honestly and disables the unusable controls, but automatic conversion is not included yet. An FFmpeg-based conversion and export engine is required to fulfill the broader WMV, iPhone, and web-format promise.

The application does not yet render or export the complete Primary Sequence. AudioStudio Pro recording and processing are not implemented yet.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.
