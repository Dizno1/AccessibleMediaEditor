# Accessible Media Editor Development Roadmap

## Purpose

Accessible Media Editor is a screen-reader-first Windows application for direct media editing, nondestructive composition, accessible multimedia authoring, and professional audio work. It must be useful for a person making one simple edit without requiring a project, while also growing into a structured professional production environment.

This roadmap is the governing build specification for future development, including work performed with CCC or another coding assistant. Conversation history is not a substitute for this document.

## Product Boundary

AccessibleScreenCapture Pro remains focused on capture, review, simple trimming, and saving. Accessible Media Editor owns multi-file composition, timeline editing, narration, text, images, transitions, captions, effects, and complete production export.

Opening an audio file in Media Editor must not automatically open AudioStudio Pro. Straightforward audio trimming, copying, insertion, gain adjustment, and fading belong in Media Editor. AudioStudio Pro is an explicitly selected workspace for professional recording, restoration, mixing, and mastering.

## Governing Interaction Principles

1. The application must work with JAWS Virtual Cursor off and on where appropriate.
2. Ctrl+PageUp and Ctrl+PageDown move among meaningful editor sections. Tab moves within the active section.
3. Every keyboard command must have a discoverable menu or control equivalent.
4. Focus must remain in the active editor while media plays.
5. Routine playback and scrubbing must not be covered by screen-reader speech.
6. Original media is never modified. Edits operate on application-owned working media and project instructions.
7. Project creation is optional. A user may open one file, edit it, save a new file, and leave.
8. Each Source Video or Source Audio file keeps its own filename-titled editor section.
9. Primary Production is the assembled output and has one continuous player and logical playhead.
10. Selection and operation are separate concepts. Brackets define selected content. Copy, Cut, Delete, Move, effects, and future commands act on that selection.
11. Conventional controls and symbols must retain their ordinary logical meaning. A specialized convention must not replace normal meaning without explicit review and agreement.
12. Exact values must always be available. No user may be forced to rely only on a visual slider or mouse drag.
13. Destructive or irreversible actions require clear confirmation. Routine reversible actions should not create unnecessary interruptions.
14. Spoken feedback must be short, accurate, and action-specific.
15. Visual controls must remain fully usable for mouse and sighted users without becoming the only interface.

## Locked Keyboard Model

- X - Play or pause the active editor.
- Space - Quietly audition around the current playhead and return to it.
- U and I - Scrub backward or forward 1 second.
- Shift+U and Shift+I - Scrub backward or forward 100 milliseconds.
- Ctrl+Alt+U and Ctrl+Alt+I - Scrub backward or forward 10 milliseconds.
- Alt+Left Arrow and Alt+Right Arrow - Move backward or forward 1 millisecond.
- Left Arrow and Right Arrow - Move backward or forward 5 seconds.
- Shift+Left Arrow and Shift+Right Arrow - Move backward or forward 30 seconds.
- J and L - Move backward or forward 5 minutes.
- Home and End - Move to the beginning or end of the active logical timeline.
- Ctrl+G - Enter an exact time in hours, minutes, seconds, and milliseconds.
- Left Bracket - Place the Left Bracket at the exact logical playhead.
- Right Bracket - Place the Right Bracket at the exact logical playhead.
- Ctrl+C - Copy the selected Source content.
- Ctrl+V - Insert at the Primary playhead when no non-empty Primary range is selected; replace a targeted track only when Primary has one continuous non-empty selected range.
- Ctrl+Shift+V - Explicitly insert copied media into the Primary sequence and increase production duration.
- Ctrl+X - Reserved for cutting selected content.
- Ctrl+Delete - Delete selected content nondestructively.
- Ctrl+K - Split at the playhead.
- Ctrl+Z and Ctrl+Y - Undo and Redo.
- Escape - Cancel an audition, dialog, or uncommitted brackets.

Shortcuts must be checked against Windows, Chromium WebView, JAWS, and native application menu conflicts before release.

## Locked Bracket Selection Model

- A lone Left Bracket selects everything to its right.
- A lone Right Bracket selects everything to its left.
- Outward brackets, Left then Right on the timeline, select the content between them.
- Inward brackets, Right then Left on the timeline, select the beginning and end while leaving the middle unselected.
- Either bracket may be placed first.
- Ctrl+C copies every selected range in chronological order.
- Ctrl+Delete deletes every selected range.
- Future Cut, Move, effects, and processing commands must use the same selected ranges.
- Announcements describe what is selected. They must not call selected content deletable data.

## Current Working Foundation

Build 0.10.8 includes:

- Optional project workflow.
- Multiple-file import through the Windows file picker.
- Local FFmpeg normalization to application-owned working files.
- Original-file preservation.
- One continuous Primary Production editor.
- Separate filename-titled Source Video and Source Audio editors.
- User-controlled Primary reassignment.
- Exact logical playheads for Primary and Source editors.
- Immediate nondestructive preview without export.
- Quiet Space audition and U/I scrubbing.
- Logical bracket selection.
- Source Copy and Primary Paste.
- Source removal with Undo.
- Primary and Source nondestructive deletion.
- Automatic bracket cleanup after completed Copy, Delete, Paste, Primary reassignment, and structural Primary edits.
- Menu equivalents for established editing commands.
- Complete video and audio Primary Production rendering and format-selectable saving.
- Independent A, V, and B track replacement instructions stored in Version 3 project files.
- Contextual Ctrl+V: insertion with no non-empty Primary selection, and replacement only with one continuous non-empty Primary selection.
- Ctrl+Shift+V as an optional explicit Insert command.
- Track replacement preview during Primary playback.
- Atomic complete-production export with queued, deduplicated, phase-gated JAWS rendering and conversion progress.
- FFmpeg audio-only, video-only, and both-track replacement at exact production times.
- Track-target changes that never rebuild the editor or disturb the active brackets, playhead, focus, or playback state.
- Bracket announcements that report the calculated selection duration as well as the absolute timeline positions.
- Primary-only A, V, or B replacement targeting. Source editors select and copy material without choosing a target.
- Paste protection that reports duration differences instead of silently truncating copied media to a shorter destination selection.
- Verified export completion, complete saved-path announcements, and direct File menu access to the Exports folder.
- Atomic export through a protected temporary file. The requested destination filename never exists until conversion succeeds and the output is verified.
- Persistent spoken conversion status instructing the user to wait for Export Complete before using an exported file.
- A dedicated modal Export in Progress experience that clears stale editing status, preserves ordered rendering announcements, provides one elapsed-time conversion update per minute, and prevents focus from falling into unrelated editor content.
- Deterministic completion ordering with focus placed on Show Saved File only after the verified final filename exists.
- Copy announcements that identify the Source and selected duration without attaching a track target to the clipboard selection.
- A focused Export Complete dialog that preserves the verified saved path for deliberate JAWS review and can reveal the actual saved file in File Explorer.
- Regression coverage for contextual insertion, Primary-controlled replacement, and shorter-destination rejection.

## Immediate Stabilization Gate

No major authoring feature should be added until all of the following pass with real media:

1. X pauses at one exact logical time.
2. A bracket placed immediately after Pause uses exactly the announced paused time.
3. Delayed media events do not move a paused logical playhead.
4. U/I scrubbing works at 1 second, 100 milliseconds, and 10 milliseconds without shortcut conflicts.
5. Scrubbing and auditioning remain quiet enough to hear the media.
6. Ctrl+Z and Ctrl+Y work after deletion, paste, Source removal, and Primary reassignment.
7. Home and End use the complete active logical timeline.
8. Primary Production plays continuously through several pasted segments.
9. Ctrl+PageUp and Ctrl+PageDown identify each destination once without redundant Current or selected announcements.
10. JAWS testing is completed with Virtual Cursor off and on, followed by an NVDA confirmation pass.

Build 0.8.6 remains the verified rollback version. Build 0.9.0 is the first complete sequential FFmpeg export milestone.

## Professional Feature Inventory

### Media Import and Organization

Planned capabilities:

- Multi-file import.
- Bins or named collections.
- Search, sorting, tags, ratings, and notes.
- Media metadata and technical properties.
- Duplicate identification.
- Missing-media reporting and relinking.
- Normalized working files.
- Optional lower-resolution proxies for large media.
- Project consolidation and archiving.
- Recent media and recent projects.

Accessible implementation:

- Every media item is represented by a concise list option.
- Detailed properties are available on demand rather than appended to every list announcement.
- Conversion and proxy creation provide progress, cancellation, success, and failure status.
- Offline media is presented in one navigable problem list with a Relink command.

### Source and Primary Editing

Preserve the current design:

- Every Source retains its own editor section.
- Ctrl+PageUp and Ctrl+PageDown move directly among Source editors and Primary Production.
- Source media is prepared nondestructively before insertion.
- Primary Production is reviewed as one continuous result.
- Removing a Source never changes the original file.

### Fundamental Editing Vocabulary

Required commands:

- Select.
- Copy.
- Cut.
- Paste.
- Insert.
- Overwrite.
- Delete.
- Ripple Delete.
- Split or Blade.
- Trim beginning or end.
- Roll edit.
- Slip edit.
- Slide edit.
- Lift.
- Extract.
- Replace clip.
- Duplicate clip.
- Move earlier or later.
- Link or unlink audio and video.
- Synchronize audio and video.
- J-cut and L-cut.

Every advanced edit must offer exact time fields, keyboard commands, a menu command, concise confirmation, immediate preview, and Undo.

### Sequence and Track Structure

Planned logical tracks:

- Primary Video.
- Overlay Video.
- Titles and Images.
- Dialogue.
- Narration and Audio Description.
- Music.
- Sound Effects.
- Captions.

Each track requires:

- A stable name and number.
- Previous Track and Next Track commands.
- List Items at Playhead.
- Target, lock, mute, solo, and enable controls.
- Exact item start, end, and duration.
- Move Item to Track.
- Announced overlap and collision information.

The visual timeline may display tracks conventionally, but the accessible interface is a structured chronological model rather than a visual strip that must be interpreted spatially.

### Markers and Navigation

Required marker functions:

- Add, name, edit, move, and delete a marker.
- Comment, chapter, synchronization, and review marker types.
- Marker descriptions and optional URLs.
- Previous Marker and Next Marker.
- Go to Marker.
- Select Between Markers.
- Chronological marker list.
- Chapter-marker export.

### Precision and Sequence Settings

Required values:

- Hours, minutes, seconds, and milliseconds.
- Optional frame-based time entry.
- Playhead time.
- Selection beginning, end, and duration.
- Clip start and end in Primary Production.
- Resolution, frame rate, aspect ratio, audio format, preview format, and color management.
- Snapping to cuts, markers, clip boundaries, and keyframes.

### Playback and Review

Required functions:

- Play and pause.
- Quiet audition.
- Play Selection.
- Loop Selection.
- Preroll and postroll.
- Play Before Edit and Play After Edit.
- Compare original with edited result.
- Variable playback speed.
- Frame forward and backward.
- Previous Cut and Next Cut.
- Continuous Primary Production playback.

### Visual Transformations

Each visual item eventually requires:

- Position, scale, rotation, crop, opacity, and anchor point.
- Fit, Fill, and Stretch.
- Aspect-ratio preservation.
- Horizontal and vertical alignment.
- Picture-in-picture.
- Background color.
- Blend mode.
- Horizontal and vertical flip.

Accessible controls must include named positions such as Top Left, Center, and Bottom Right, plus exact X and Y values. The application should announce approximate screen coverage and warn about collisions with captions, text, faces, or other important content.

### Text, Titles, Graphics, and Still Images

Text Overlay and Title Card are separate operations.

Required text controls:

- Content, start time, end time, and duration.
- Position, alignment, font, size, color, and background.
- Contrast checking.
- Entrance and exit behavior.
- Safe-area checking.
- Reusable styles.
- Reading-order information.

Required image controls:

- Exact duration.
- Position, scale, crop, Fit, and Fill.
- Background color.
- Pan and zoom.
- Fade in and out.
- Alternative-text notes stored in the project.
- Spoken position and overlap warnings.

### Transitions

Initial transition set:

- Cut.
- Crossfade.
- Fade through black.
- Fade through white.
- Audio crossfade.
- Audio dip.
- Exact transition duration.

Transitions are selectable sequence objects. They can be moved, changed, deleted, and undone.

### Speed and Timing

Planned functions:

- Constant speed change.
- Slow motion and fast motion.
- Reverse.
- Freeze frame and hold frame.
- Variable-speed ramps.
- Preserve or alter audio pitch.
- Fit media to an exact duration.

### Effects and Motion

Initial practical effects:

- Brightness, contrast, saturation, sharpen, blur, noise reduction, and stabilization.
- Chroma key and background replacement.
- Privacy blur for faces, names, and sensitive information.
- Vignette.

Later professional effects:

- Masks.
- Motion and object tracking.
- Rotoscoping.
- Compositing.
- 2D and 3D motion graphics.
- Plugin support.

### Keyframes and Automation

Keyframes are exposed as a chronological list, for example:

- Keyframe 1 - 00:00:03.500 - Opacity 0 percent.
- Keyframe 2 - 00:00:04.500 - Opacity 100 percent.

Commands include Add, Remove, Set Time, Set Value, Move Earlier, Move Later, Previous Keyframe, Next Keyframe, and interpolation type.

### Color Correction and Grading

Initial controls:

- Automatic correction.
- White balance.
- Exposure.
- Contrast.
- Highlights and shadows.
- Saturation.
- Temperature and tint.

Later controls:

- Color wheels and curves.
- Shot matching.
- Scopes.
- Secondary correction.
- Masks.
- HDR.
- LUT import and export.
- Color-space management.

Automated analysis may report underexposure, clipped highlights, low contrast, color casts, or disagreement between adjacent clips. Machine guidance must be labeled as guidance rather than verified visual judgment.

### Captions, Transcripts, and Text-Based Editing

Required capabilities:

- Import and export captions.
- Create and edit captions manually.
- Speech-to-text generation.
- Exact caption timing.
- Speaker identification.
- Caption styling and placement.
- Overlap and reading-speed checks.
- Sidecar, embedded, and burned-in caption export.
- Multiple languages.
- Transcript search and export.
- Video editing through transcript Copy, Cut, Paste, and Delete.

### Accessibility-Specific Production Tools

Accessible Media Editor should exceed conventional editors through:

- A dedicated Audio Description role or track.
- Narration recording.
- Audio-description gap finding.
- Caption overlap and reading-speed warnings.
- Flash and seizure-risk checks.
- Text-overlay contrast checks.
- Caption-safe and title-safe area checks.
- Spoken object and overlay position.
- Collision warnings.
- Alternative-text notes for still images.
- Transcript and caption consistency checks.
- An accessible-export checklist.
- A chronological list of every non-video production element.

### Multicamera Editing

Later multicamera support should provide:

- Synchronization by timecode, audio, marker, or exact manual offset.
- Named and numbered camera angles.
- Current angle and next angle-change announcements.
- Audio follows video, fixed master audio, or independent audio choices.
- Keyboard angle switching.
- Chronological angle-change list.

Multicamera work begins only after single-sequence production and export are reliable.

### Export and Delivery

Required functions:

- Render the complete Primary Production.
- Choose video and audio formats.
- Choose resolution, frame rate, codec, bitrate, quality, and sample rate.
- Choose mono or stereo.
- Export captions as sidecar, embedded, or burned in.
- Export audio only, video only, a still frame, or a selected range.
- Web, presentation, archive, and mobile presets.
- Render queue and batch export.
- Progress, cancellation, estimated output size, and error log.
- Separate dialogue, narration, music, and effects stems.
- Project archive.
- Later XML, AAF, OMF, and EDL interchange.

### Project Safety and History

Required protections:

- Optional projects.
- Automatic recovery.
- Autosave.
- Named save points.
- Undo and Redo history.
- Recent media and projects.
- Relink missing media.
- Archive a project with its media.
- Clean temporary files safely.
- Never alter original media.

## Development Phases

### Phase 1 - Stabilize the Existing Editor

- Exact pause-to-bracket synchronization.
- Reliable precision scrubbing.
- Remaining JAWS verbosity reduction.
- Undo and Redo verification.
- Continuous multi-item Primary playback verification.
- Source removal and Primary reassignment verification.

Exit requirement: every item in the Immediate Stabilization Gate passes with JAWS and receives an NVDA confirmation pass.

### Phase 2 - Render and Export the Complete Production

Build 0.9.0 implements the first complete video and audio rendering path. Real-media verification is required before Phase 2 is considered complete.

- FFmpeg rendering of every Primary Production item in sequence.
- Video and audio normalization during final render.
- Format-selectable export.
- Progress and cancellation.
- Export error reporting.
- Selected-range and audio-only export.

Exit requirement: a production containing at least three different source formats exports as one playable file with correct order, duration, audio, and edits.

### Phase 3 - Complete Fundamental Editing

- Cut, Copy, Paste, Insert, Overwrite, Ripple Delete, Split, Replace, Duplicate, and Move.
- Exact item placement.
- Markers.
- Play Selection and Loop Selection.
- Previous Cut and Next Cut.
- Initial Roll, Slip, and Slide workflows.

Exit requirement: every operation previews immediately, has Undo and Redo, has a menu equivalent, and never changes original media.

### Phase 4 - Tracks and Roles

- Video, overlay, title, dialogue, narration, music, effects, and caption tracks.
- Target, lock, mute, solo, and enable.
- Move items among tracks.
- List overlapping items at the playhead.

Exit requirement: the complete track structure is operable without interpreting the visual timeline.

### Phase 5 - Multimedia Authoring

- Still images with exact durations.
- Overlay text and separate title cards.
- Basic transitions.
- Position, crop, scale, rotation, and opacity.
- Spoken placement descriptions.
- Safe-area and collision warnings.

Exit requirement: Tanja's example can be built, reviewed, saved, reopened, and exported entirely by keyboard.

### Phase 6 - Captions, Transcripts, and Audio Description

- Caption import, creation, editing, and export.
- Speech-to-text.
- Transcript search and text-based editing.
- Reading-speed and overlap checks.
- Audio Description role and timing tools.

Exit requirement: captions and Audio Description can be created, inspected chronologically, validated, and exported accessibly.

### Phase 7 - Visual Finishing

- Basic color correction.
- Stabilization.
- Blur and privacy masking.
- Speed changes and freeze frames.
- Keyframes.
- Motion tracking.
- Advanced effects.

### Phase 8 - Advanced Professional Workflows

- Multicamera editing.
- Proxy management.
- Interchange formats.
- Batch export.
- Project consolidation.
- Collaboration and review tools.

## AudioStudio Pro Workspace

AudioStudio Pro begins after the shared Media Editor foundation and complete production rendering are reliable. It is selected intentionally through its own tab or workspace command.

Media Editor continues to handle:

- Simple audio trimming.
- Copying and inserting audio.
- Basic gain.
- Fade in and fade out.
- Adding narration, music, or an externally prepared mix.

AudioStudio Pro will handle:

- Multitrack and sample-accurate editing.
- Professional voice recording.
- Waveform and spectral tools.
- Noise reduction and restoration.
- Equalization, compression, limiting, de-essing, and reverb.
- Pitch and tempo.
- Loudness targets.
- Panning.
- Buses and submixes.
- Automation.
- Plugins.
- ADR and Foley.
- Stereo and surround mastering.
- Stem export.
- Send completed audio mix to Media Editor.
- Import a completed custom mix into a video while preserving synchronization.

The AudioStudio Pro interface should follow the same principles as Media Editor: named sections, exact values, quiet transport, logical selections, menu equivalents, immediate nondestructive review, and full keyboard control.

## Required Quality Checks for Every Build

1. Run all automated tests.
2. Validate JavaScript syntax, JSON, and Tauri configuration.
3. Prepare the frontend distribution.
4. Confirm the ZIP excludes .git, node_modules, Rust target files, and temporary binaries.
5. Test installation on Windows.
6. Test the stated feature with JAWS and Virtual Cursor off.
7. Test navigation and documentation with Virtual Cursor on.
8. Perform an NVDA confirmation pass for major interaction changes.
9. Verify focus placement after every command.
10. Verify original files remain unchanged.
11. Verify Undo and Redo.
12. Verify all keyboard commands have menu or control equivalents.
13. Record known limitations honestly in README and TestingGuide.txt.

## Reference Feature Sets

This roadmap was informed by the official documentation for Adobe Premiere, Apple Final Cut Pro, Avid Media Composer, and Blackmagic Design DaVinci Resolve. Those products establish the professional feature categories, but their visual interaction models are not the Accessible Media Editor interface specification.

- Adobe Premiere Help: https://helpx.adobe.com/premiere/desktop.html
- Apple Final Cut Pro User Guide: https://support.apple.com/guide/final-cut-pro/welcome/mac
- Avid Media Composer: https://www.avid.com/media-composer
- Blackmagic Design DaVinci Resolve: https://www.blackmagicdesign.com/products/davinciresolve

