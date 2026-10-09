# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, and optional professional audio work.

## Build 0.4.2

Build 0.4.2 makes U/I scrubbing silent so screen-reader speech does not cover the media sample. It also retains the dedicated editor introduced for every playable Primary and Source item.

- The first opened file becomes Primary Media.
- Additional files become Source Media and are excluded from output until inserted.
- Every video or audio item has a titled editor section containing its own preview player, playhead slider, position, marks, track target, and editing controls.
- The title identifies both the role and filename, such as `Primary Video - Demonstration` or `Source Video 1 - Example`.
- Selecting an item in either list activates the matching editor. Enter moves directly into it.
- Importing another Source file does not steal keyboard control from the Primary editor.
- Ctrl+Page Up and Ctrl+Page Down cycle through Media Library, every named media editor, and Output.
- X plays or pauses the active editor from its current playhead.
- Space auditions around that playhead and returns to the original position.
- U and I scrub by 1 second; Shift+U/I by 100 milliseconds; Ctrl+Shift+U/I by 10 milliseconds. These commands do not announce the filename, timestamp, or audition completion, allowing the media sample to be heard.
- Left and right brackets set In and Out marks.
- B, V, and A target both tracks, video only, or audio only.
- A marked Source selection can be inserted at the Primary playhead or appended.
- Ctrl+Tab switches between Media Editor and the optional AudioStudio Pro workspace.

All operations are nondestructive. Source files are not modified.

This build does not yet render or export the complete Primary Sequence. AudioStudio Pro recording and processing are not implemented yet.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.

## Test priorities

1. Open one video and confirm it becomes Primary Media with its own named editor and slider.
2. Open a second video and confirm it becomes Source Media with a separate named editor and slider.
3. Confirm opening Source Media leaves Primary Media active.
4. Arrow between the Primary and Source lists and verify X always controls the selected item.
5. Press Enter on a list item and verify focus moves to its editor.
6. Cycle all editors with Ctrl+Page Up and Ctrl+Page Down.
7. Verify X, Space, U/I, brackets, and B/V/A independently in each editor.
8. Mark part of Source Media and insert it at the remembered Primary playhead.
