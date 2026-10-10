# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, and optional professional audio work.

## Build 0.6.1

Build 0.6.1 corrects the first 0.6.0 field-test findings and adds the conversion and output boundaries required for future composition.

- Every imported video and audio file is normalized to an app-owned MP4 or M4A working copy before editing.
- The original uploaded file and its name remain preserved in the project model.
- WMV, MOV, WebM, iPhone media, and other FFmpeg-readable formats no longer depend on WebView2 preview support.
- Source In and Out marks no longer restrict playback or navigation.
- Home and End always move to the beginning and end of the complete Source file.
- Ctrl+Z removes the most recently set uncommitted mark before undoing committed project changes.
- Escape cancels all uncommitted marks in the active editor.
- Ctrl+E opens a Save as type choice for MP4, MOV, WebM, M4A, MP3, or WAV.
- Screen-reader visual positioning, layout description, and conflict detection requirements are now recorded in the roadmap for later composition builds.

## Build 0.6.0

Build 0.6.0 replaces playback-boundary pretending with the first real editing engine.

- Left bracket and Right bracket set edit marks without changing the media.
- Ctrl+Delete commits the marked removal to a nondestructive retained-segment plan.
- With only an Out mark, Ctrl+Delete trims the tail. With only an In mark, it trims the beginning.
- Playback, the playhead, Home and End, and U and I scrubbing immediately use logical edited time.
- Playback skips removed media without requiring export first.
- Undo restores the prior edit plan.
- A verified FFmpeg sidecar creates a separate edited working file. The original is never changed.
- Ctrl+E saves the edited working file to a user-selected location after rendering completes.
- The GitHub workflow downloads the LGPL static FFmpeg build and verifies its SHA256 checksum before packaging it.

Build 0.5.1 fixed the first-import regression and made loading transactional.

- The null-control error during first media import is fixed.
- A failed import rolls back completely instead of leaving Source media without Primary media.
- The application announces that selected media is loading.
- Playback, audition, and playhead controls remain disabled until metadata finishes loading.
- Ctrl+Delete is reserved for setting the Primary working trim end.
- A failed import cannot silently change the active editor.

Build 0.5.0 corrected the Primary trim and Source-selection workflow.

- Primary brackets are now identified as Trim Start and Trim End.
- Primary editor trim controls distinguish working trim boundaries from final file export.
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

## Current limits

Build 0.6.1 proves normalization, real editing, immediate review, Undo, and format-selectable saving for one Primary video or audio file. Conversion progress percentages, multi-item composition export, and AudioStudio Pro recording and processing are not implemented yet.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.
