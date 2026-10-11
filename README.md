# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, and optional professional audio work.

## Build 0.7.3

Build 0.7.3 extends logical bracket editing to every Source Video and Source Audio editor. Ctrl+Delete edits the active Source working timeline nondestructively, playback and copying use that edited timeline, and the original Source file remains unchanged. Removing a Source clears stale bracket history so the first Ctrl+Z restores the removed Source and returns focus to its editor.

## Build 0.7.2

Build 0.7.2 makes media auditioning genuinely quiet. Space, U, I, and their precision variants play the media sample without live "Auditioning" or "Returned" announcements talking over it.

## Build 0.7.1

Build 0.7.1 corrects and tests the bracket-selection model.

- A lone Left Bracket selects everything to its right.
- A lone Right Bracket selects everything to its left.
- Paired brackets select only the content enclosed between them.
- Ctrl+Delete deletes the selected content and preserves everything outside the bracketed area.
- Spoken confirmations identify whether the beginning, ending, or enclosed selection will be deleted.
- Ctrl+C clears Source brackets after copying while preserving the internal media clipboard.
- The Edit menu provides Copy Source Selection Ctrl+C and Paste into Primary Production Ctrl+V.
- End reached is announced only once.

## Build 0.7.0

Build 0.7.0 replaces the disconnected inserted-item editors with a ScreenCapture-style Primary Production experience.

- One Primary Production player and playhead cover the complete sequence.
- Pasted video or audio becomes part of that continuous production instead of opening another editor region.
- Each imported Source Video and Source Audio keeps its own filename-titled editor section.
- Ctrl+Page Up and Ctrl+Page Down move directly among Primary Production, every Source editor, Media Management, and Output.
- Left and Right Bracket mark a Source selection.
- Ctrl+C copies the marked Source selection into the application's internal media clipboard.
- Ctrl+V pastes it at the Primary Production playhead.
- End followed by Ctrl+V appends the selection without a separate Append command.
- Every Source editor includes Remove Source from Project. The original file and already pasted production material remain unchanged.
- Inserted items no longer create focus jumps into additional editing regions.
- Source audio uses the same ordinary Media Editor workflow and does not require AudioStudio Pro.

Build 0.7.0 provides immediate continuous playback of a multi-item production. FFmpeg rendering of that multi-item production is intentionally not presented as complete yet; format-selectable export remains available for a normalized or edited single-media production.

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
- This build introduced single-mark deletion, but its single-bracket direction was incorrect and was corrected in Build 0.7.1.
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

Build 0.7.3 proves normalization, dedicated and nondestructively editable Source editors, quiet media auditioning, logical bracket selection, copy and paste, continuous Primary Production review, Undo, and format-selectable saving for one Primary video or audio file. Conversion progress percentages, multi-item composition export rendering, and AudioStudio Pro recording and processing are not implemented yet.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.

10/11/2026: Changing a file so the app will push.