# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for precise media editing and optional multimedia authoring.

## Build 0.3.1

This build introduces the direct-edit-first application structure.

Build 0.3.1 corrects native window titles, quiets automatic playhead announcements, removes duplicate editing controls, and adopts the shared Open Door editing shortcuts.

- Open Media is the starting action. Creating a project is not required.
- Ctrl+O opens one or several audio, video, or image files.
- The selected filename becomes the main heading and application title when one file is open.
- Media, Playback, Edit, and Output are distinct editor sections.
- Ctrl+Page Up and Ctrl+Page Down move between sections with the JAWS Virtual Cursor off.
- Tab moves through the controls inside the active section.
- All displayed and announced durations use human-readable hours, minutes, seconds, and milliseconds.
- Existing millisecond-precision In, Out, nudge, split, preview, and multi-file features are preserved.
- U and I scrub by one second. Shift+U and Shift+I scrub by 100 milliseconds. Ctrl+Shift+U and Ctrl+Shift+I scrub by 10 milliseconds.
- Left bracket and right bracket set the In and Out marks.
- Left and Right Arrow move by 5 seconds. Shift+Left and Shift+Right move by 30 seconds. J and L move by 5 minutes.
- Alt+Left and Alt+Right retain one-millisecond precision. Home and End jump to the beginning and end.
- Project commands remain available in the File menu. Ctrl+Shift+O opens a project.
- Export Edited Media is present but disabled until the rendering engine is implemented.

Preview uses the Windows media engine. Some codecs, particularly HEVC, may require an installed Windows decoder. FFmpeg-backed decoding and export remain future work.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.

## Test priorities

1. Confirm startup focus is Open Media.
2. Open one media file with Ctrl+O and verify the heading and window title.
3. Move through all four sections with Ctrl+Page Up and Ctrl+Page Down while the Virtual Cursor is off.
4. Tab through the controls in each section.
5. Confirm all time announcements are human-readable.
6. Open multiple files and verify list selection and rearranging.
7. Retest preview, In, Out, exact time entry, one-millisecond nudge, and split.
8. Save and reopen an optional project.
