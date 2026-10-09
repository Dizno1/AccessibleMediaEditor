# Accessible Media Editor

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, and optional professional audio work.

## Build 0.4.0

Build 0.4.0 establishes the Primary Media and Source Media architecture.

- The first opened file becomes Primary Media.
- Additional files become Source Media instead of automatically extending the output.
- Source duration is excluded from the primary sequence until a selection is inserted.
- Each active media context has its own remembered playhead, In and Out marks, and track target.
- Playback and Edit section headings include the active media title.
- X plays or pauses continuously from the current playhead.
- Space auditions around the playhead and returns to the original position.
- U and I scrub by 1 second.
- Shift+U and Shift+I scrub by 100 milliseconds.
- Ctrl+Shift+U and Ctrl+Shift+I scrub by 10 milliseconds.
- Left and right brackets set the In and Out marks.
- B, V, and A target both tracks, video only, or audio only.
- A marked Source selection can be inserted at the selected Primary Sequence playhead or added to the end.
- Ctrl+Tab and Ctrl+Shift+Tab switch between Media Editor and AudioStudio Pro.
- AudioStudio Pro is an explicit, optional workspace and is never opened automatically for an audio file.
- Professional recording and processing controls are present only as disabled future-work indicators.

All operations are nondestructive. Source files are not modified.

This build does not yet render the complete Primary Sequence or export edited media. The AudioStudio Pro processing engine is also not implemented yet.

## Developer commands

- `npm install`
- `npm test`
- `npm run desktop:dev`
- `npm run desktop:build`

Windows installers are produced as MSI and NSIS packages by the GitHub Actions workflow.

## Test priorities

1. Open one video and confirm it becomes Primary Media.
2. Open a second video and confirm it becomes Source Media.
3. Confirm Source Media does not increase Primary Sequence duration before insertion.
4. Select Primary and Source items and confirm Playback and Edit headings include the active title.
5. Verify X Play/Pause and Space Audition.
6. Verify U/I scrubbing and bracket marks.
7. Verify B, V, and A targeting announcements.
8. Mark part of Source Media and insert it at the remembered Primary playhead.
9. Confirm each media item remembers its playhead when switching contexts.
10. Switch workspaces with Ctrl+Tab and confirm AudioStudio Pro does not open automatically.
