# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for arranging video, images, narration, audio, text, and transitions into a finished production.

## Build 0.2 purpose

This build turns the Windows interaction model into a usable precision-trimming workspace. It intentionally does not copy the former long web interface.

- Native Windows application menus.
- Shared menu and keyboard command handlers.
- Native Open, Save, and Import dialogs.
- One ordered Project Items list.
- Add image, audio, video, text, and crossfade items.
- Move items earlier or later.
- Preview selected video and audio items.
- Set nondestructive In and Out points to 0.001-second precision.
- Enter exact positions with separately labeled Hours, Minutes, Seconds, and Milliseconds fields.
- Nudge the playhead by one millisecond with Alt+Left and Alt+Right.
- Split a video or audio item nondestructively at the exact playhead position with Ctrl+K.
- Edit item labels and exact durations.
- Remove, undo, and redo.
- Save and reopen `.ameproject` project descriptions in `Documents/Accessible Media Editor/Projects` by default.
- Open the default Projects folder from the File menu.
- Import multiple files in one operation, including common iPhone, web-video, audio, and image file extensions.
- Paste a copied multi-file File Explorer selection into the Import Media dialog, using the proven Windows picker behavior from Accessible Audio Studio Pro.
- Explain that Ctrl+I imports media when a non-project file is mistakenly selected with Open Project.
- One authoritative playhead control.
- One status announcer.
- Optional sound cues.

Preview uses the Windows media engine in Build 0.2. Some codecs, particularly HEVC, may require an installed Windows decoder. The planned FFmpeg composition engine will provide broader decoding and MP4 export in a later build.

## Developer commands

Copy Build 0.2 into the existing AccessibleMediaEditor repository and replace matching files.

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages.

## Test priorities

1. Confirm Alt reaches the native menu bar and all seven menus are announced.
2. Import at least two media files with Ctrl+I.
3. Copy at least three media files in File Explorer, paste them into the Import Media dialog, and confirm that all three become project items.
4. Use the Project Items list without turning the Virtual Cursor on.
5. Move an item with Ctrl+Up and Ctrl+Down and confirm focus remains in the list.
6. Preview a selected video or audio item with Ctrl+P.
7. Set In and Out points with I and O.
8. Nudge the playhead with Alt+Left and Alt+Right.
9. Press Ctrl+G and enter a time using the four separately labeled fields.
10. Open Item Properties with Alt+Enter and type exact In and Out values.
11. Save, close, and reopen a project.
12. Confirm announcements are concise and not duplicated.
