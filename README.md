# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for arranging video, images, narration, audio, text, and transitions into a finished production.

## Build 0.1 purpose

This build establishes the new Windows interaction model. It intentionally does not copy the former long web interface.

- Native Windows application menus.
- Shared menu and keyboard command handlers.
- Native Open, Save, and Import dialogs.
- One ordered Project Items list.
- Add image, audio, video, text, and crossfade items.
- Move items earlier or later.
- Edit item labels and durations.
- Remove, undo, and redo.
- Save and reopen `.ameproject` project descriptions.
- One authoritative playhead control.
- One status announcer.
- Optional sound cues.

Playback and composition export are deliberately deferred until the new workspace has been tested with screen readers.

## Developer commands

After copying Build 0.1 into the existing AccessibleMediaEditor repository, activate `RemoveWebPrototypeFiles.bat` once. It removes only obsolete Python server, web-template, and batch-launcher files. It does not remove Git history, the new Windows application, or the existing `data` folder.

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages.

## Test priorities

1. Confirm Alt reaches the native menu bar and all seven menus are announced.
2. Import at least two media files with Ctrl+I.
3. Use the Project Items list without turning the Virtual Cursor on.
4. Move an item with Ctrl+Up and Ctrl+Down and confirm focus remains in the list.
5. Open Item Properties with Alt+Enter and change an image duration.
6. Save, close, and reopen a project.
7. Confirm announcements are concise and not duplicated.
