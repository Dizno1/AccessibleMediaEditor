# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, and optional professional audio work.

The governing product plan, locked interaction rules, professional feature inventory, phased implementation order, and acceptance requirements are in [AccessibleMediaEditorDevelopmentRoadmap.md](AccessibleMediaEditorDevelopmentRoadmap.md).

## Build 0.11.1

Build 0.11.1 retains the repaired Split at Playhead behavior and fixes the packaged Windows startup regression that could open an empty `about:blank` webview. The main application window is now created explicitly with the bundled `index.html` application page.

- Ctrl+K identifies the sequence item under the global Primary playhead and splits it at the correct item-relative logical time.
- Previously trimmed or nondestructively edited items split correctly across retained media segments.
- Total production duration and original files remain unchanged.
- The second segment is selected in Primary Production contents, while focus and the playhead remain in Primary Production.
- The confirmation reports the exact split time and both resulting durations.
- Ctrl+Z restores the unsplit item.
- Source editors no longer expose a Split button that cannot be used.

## Build 0.10.8

Build 0.10.8 completes the screen-reader export narration stabilization.

- Rendering-stage messages use a dedicated polite live region instead of the general editing history.
- Messages are queued and spoken once in their original order even when FFmpeg finishes stages rapidly.
- The Windows Save dialog cannot open until all queued rendering messages and the destination handoff have been presented.
- Exact duplicate progress events are ignored.
- Rendering messages cannot leak into the Save dialog, final conversion, or Export Complete dialog.

## Build 0.10.7

Build 0.10.7 restores the useful spoken rendering stages and keeps them in the correct part of the export conversation.

- JAWS again hears each production item, joining, track-replacement, and applying stage while rendering.
- Delayed rendering events are ignored after the native Save dialog begins, so they cannot leak into destination selection or completion.
- The changing progress text is no longer the dialog description, preventing repeated full-dialog speech.
- A short handoff announces that rendering is complete before the native Save dialog opens.
- Long final format conversion retains the once-per-minute elapsed-time update.

## Build 0.10.6

Build 0.10.6 corrects the complete screen-reader export conversation.

- Continuing from the format dialog clears stale editing announcements before focus changes.
- A modal Export in Progress dialog prevents focus from falling back into unrelated editor content.
- The existing production-item, join, replacement, and save-dialog announcements remain intact.
- Final format conversion announces an elapsed-time update once per minute without excessive speech.
- Delayed native progress events are ignored after the progress dialog closes.
- The logically late Finalizing announcement was removed so nothing can announce finalization after Export Complete.
- Export Complete moves focus directly to Show Saved File and exposes the verified path through the dialog description.

## Build 0.10.5

Build 0.10.5 makes export atomic and prevents unfinished output from appearing to be complete.

- FFmpeg writes every export to a protected temporary filename.
- The requested destination filename is created only after conversion succeeds and the temporary output is verified.
- Closing or interrupting the application during conversion cannot leave an incomplete file under the requested final filename.
- JAWS announces that conversion is in progress and explicitly instructs the user to wait for the focused Export Complete dialog.
- Failed conversions remove the temporary output and report that no completed destination file was created.
- Existing destination files are not replaced until the new export has completed successfully.

## Build 0.10.4

Build 0.10.4 restores logical Paste behavior and makes Primary Production solely responsible for replacement targeting.

- Ctrl+V inserts copied Source material when Primary has no selected range.
- Empty Primary brackets identify an insertion point; they do not cause replacement or remove existing media.
- Ctrl+V replaces media only when Primary has a real, non-empty selected range.
- A, V, or B is chosen in Primary Production and determines whether Paste replaces audio, video, or both inside that Primary range.
- Source editors only select and copy material. Users do not choose A, V, or B in a Source editor.
- Ctrl+Shift+V remains an optional explicit Insert command, but ordinary insertion no longer requires it.
- Replacement rejects a copied selection that is longer than the selected Primary destination instead of truncating it.

## Build 0.10.3

Build 0.10.3 completes the current track-replacement stabilization pass.

- Copy announces the selected duration, Source name, and stored Audio Only, Video Only, or Both Audio and Video target.
- Export completion opens a focused, labeled dialog containing the complete verified saved path so JAWS does not have to catch a transient live-region message.
- The completion dialog provides Show Saved File and Close buttons, and Show Saved File selects the actual export even when it was saved outside the default Exports folder.
- Automated coverage confirms that shorter bracketed destinations are rejected before truncation.
- Automated coverage confirms that one Primary Left Bracket replaces from that boundary using the complete copied selection.

## Build 0.10.2

Build 0.10.2 makes track replacement timing and export results explicit.

- Every bracket announcement includes the selected duration, so users never have to subtract timeline positions.
- A, V, or B chosen in the Source travels with the copied selection and controls the corresponding paste.
- Paste is canceled with a precise comparison when a copied selection is longer than a bracketed destination, preventing silent truncation.
- A single Primary Left Bracket remains the simple way to paste the complete copied selection from that starting point.
- Export success is announced only after the saved file is verified, and the complete saved path is included.
- File menu now includes Open Exports Folder.

## Build 0.10.1

Build 0.10.1 prevents track targeting from interrupting an edit in progress.

- Pressing A, V, or B changes only the active track target.
- Target changes do not rebuild the editor.
- The playhead, Left Bracket, Right Bracket, bracket history, focus, and playback state remain unchanged.
- A regression test covers setting a Left Bracket, changing to Audio Only, and then completing the selection with a Right Bracket.

## Build 0.10.0

Build 0.10.0 introduces independent Primary Production track replacement.

- A targets audio while preserving the existing video.
- V targets video while preserving the existing audio.
- B targets both audio and video.
- Ctrl+V replaces the targeted track from the Primary playhead or within one continuous Primary bracket range without changing production duration.
- Ctrl+Shift+V remains the deliberately separate Insert command and increases production duration.
- Track replacements are nondestructive, persisted in Version 3 project files, immediately available in Primary playback, and reversible with Undo and Redo.
- FFmpeg applies every replacement at its exact production time during export.
- Save Project As is distinguished from format-selectable Export Complete Production.

## Build 0.9.0

Build 0.9.0 introduces complete Primary Production rendering.

- Ctrl+E renders every video and audio item in Primary Production in timeline order.
- Retained edit segments are applied nondestructively from normalized source media.
- Video is standardized to 1280 by 720 at 30 frames per second for reliable joining.
- Audio is standardized to stereo AAC at 48 kHz.
- Audio-only items receive a black video frame.
- Video-only items and videos without audio receive silence.
- Rendering announces progress for each item and the final join.
- The completed production can be saved as MP4, MOV, WebM, M4A, MP3, or WAV.
- Text, image, and transition rendering remain future stages and are rejected explicitly in this build.

## Build 0.8.6

Build 0.8.6 makes Space audition the actual editing decision.

- With brackets set, Space plays the complete selected content.
- Inward brackets audition both selected ends in timeline order.
- Without brackets, Space plays continuously from the current playhead.
- Pressing Space again stops the audition and returns to the original playhead.
- X remains ordinary Play/Pause, while U and I remain short precision scrub samples.

## Build 0.8.5

Build 0.8.5 restores audible U/I scrubbing on Windows.

- Scrubbing waits for the requested media position to finish seeking before playback begins.
- The stop timer begins only after playback actually starts.
- Each scrub command plays a 500-millisecond media sample.
- Quiet scrubbing does not write Auditioning or Playhead messages to the live status region.

## Build 0.8.4

Build 0.8.4 prevents completed selections from leaking into the next operation.

- Copy clears the completed Source brackets.
- Delete clears the completed brackets in the edited timeline.
- Paste clears stale Primary brackets after changing the production timeline.
- Primary reassignment and structural Primary edits clear obsolete brackets.
- Ctrl+Z immediately after a completed operation reaches that operation instead of an old bracket.

## Build 0.8.3

Build 0.8.3 stabilizes the editing foundation before multi-item rendering.

- X freezes the exact logical playhead position before announcing Pause.
- Delayed media time-update events cannot move a paused playhead.
- A bracket placed during playback captures the current logical media position.
- Ctrl+Alt+U and Ctrl+Alt+I scrub by 10 milliseconds without colliding with Chromium View Source or Developer Tools commands.
- Active-editor styling no longer uses aria-current, removing repeated Current announcements from JAWS.
- The comprehensive development roadmap is stored in AccessibleMediaEditorDevelopmentRoadmap.md.

## Build 0.8.2

Build 0.8.2 makes bracket geometry a shared selection model and uses the user's logical orientation terminology.

- A lone Left Bracket selects everything to its right.
- A lone Right Bracket selects everything to its left.
- Outward-facing brackets, Left then Right on the timeline, select the content between them.
- Inward-facing brackets, Right then Left on the timeline, select both ends and leave the middle unselected.
- Either bracket may be placed first.
- Ctrl+C copies the selected Source content, including both selected ends of an outward selection.
- Ctrl+Delete deletes the same selected content.
- Spoken confirmations describe the selection without assuming which operation will follow.
- Bracket announcements are concise and do not repeat shortcut instructions after every mark.
- The model is shared by Primary Production and every Source editor.
- Make Selected Source Primary swaps the selected Source with the current Primary without deleting either file or its edits.
- The Primary swap is available as a Media Management button and Project menu command.
- Ctrl+Z and Ctrl+Y reverse and reapply bracket edits and Primary swaps.
- Item Properties uses Left Bracket and Right Bracket terminology.

## Build 0.7.5

Build 0.7.5 registers Ctrl+Z and Ctrl+Y as real application shortcuts instead of menu text only. It also keeps the logical playhead anchored throughout a quiet Space audition. Pressing a bracket during an audition first returns to the anchor, preventing a moving audition position from becoming an unintended deletion boundary.

## Build 0.7.4

Build 0.7.4 corrects the time conversion used when X pauses edited media. The player now converts original-file time back into edited-timeline time before saving the playhead, so repeated play and pause no longer moves the playhead and Space auditions the location where playback was actually paused.

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

The first opened file becomes Primary Media. Additional files become Source Media and are excluded from output until inserted or used for replacement. Every supported video or audio item has a titled editor section containing its own preview player, playhead slider, position, brackets, and editing controls. Audio Only, Video Only, and Both Audio and Video replacement targets appear only in Primary Production.

All operations are nondestructive. Source files are not modified.

## Current limits

Build 0.9.0 adds FFmpeg rendering and format-selectable export for the complete video and audio Primary Production. Text, still-image, transition, caption, and AudioStudio Pro rendering are not implemented yet.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.
