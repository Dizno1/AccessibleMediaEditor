# Accessible Media Editor

## Product Definition and Initial Requirements

Version 0.1 - September 7, 2026

## Implementation status

Accessible Media Editor build 0.7.0 establishes a unified Primary Production player, dedicated filename-titled Source Video and Source Audio editors, logical Ctrl+C and Ctrl+V media editing, automatic working-media normalization, immediate nondestructive playback, Undo, and format-selectable single-media saving. Multi-item export rendering remains the next development stage after continuous Primary Production playback is verified.

## Product purpose

Accessible Media Editor is a screen-reader-first multimedia editor and authoring studio from Open Door Design. It enables a user to arrange video, screen recordings, still images, narration, other audio, and text into a complete production and export the result as a new MP4.

The application is intended for accessibility demonstrations, training modules, presentations, family-memory projects, and other productions that combine several kinds of media.

## Product boundary

AccessibleScreenCapture Pro and Accessible Media Editor are related applications with distinct central jobs.

AccessibleScreenCapture Pro:

- Captures a screen recording.
- Reviews the captured recording.
- Provides straightforward, non-destructive edits such as trimming.
- Saves the edited recording.
- Can send a completed recording to Accessible Media Editor.

Accessible Media Editor:

- Combines multiple media items into one production.
- Arranges items into a sequence.
- Controls the duration of still images and text items.
- Adds narration and other audio.
- Adds text to the production.
- Adds transitions between items.
- Exports the complete composition as a new MP4.

Simple trimming belongs in AccessibleScreenCapture Pro. Full composition belongs in Accessible Media Editor.

## Connection between the applications

AccessibleScreenCapture Pro should eventually include a "Send to Accessible Media Editor" action. Activating it should open or create a Media Editor project and add the completed recording as a project item. The editor can then add other recordings, screenshots, images, narration, audio, text, and transitions.

The handoff must not require the user to locate and import the recording again.

## Foundational interaction model

The primary model is an ordered sequence of meaningful project items. A visual timeline may be available, but it must not be the only way to understand or edit the project.

Example sequence:

- Item 1. Screenshot. Duration 20 seconds.
- Item 2. Screen recording. Duration 1 minute 42 seconds.
- Item 3. Image. Duration 15 seconds.

Every item must expose its type, name or description, start time, duration, and relevant attached media through screen-reader-accessible controls.

Core item actions:

- Insert Before.
- Insert After.
- Move Earlier.
- Move Later.
- Move to Beginning.
- Move to End.
- Edit Properties.
- Add Narration.
- Set Duration.
- Preview Item.
- Remove from Project.

The application must announce the result of each action and preserve a predictable focus position.

## Tanja's reference use case

The editor must support this complete workflow:

1. Add a screenshot that demonstrates an accessibility defect.
2. Set the screenshot duration to 20 seconds.
3. Add recorded narration explaining the defect beneath the screenshot.
4. Add a transition.
5. Add a screen recording that demonstrates the behavior.
6. Continue with another screenshot, image, or video.
7. Export the entire sequence as one MP4.

This is a defining real-user scenario for Accessible Media Editor and should become an acceptance test.

## Required media types

- Video files.
- Screen recordings.
- Still screenshots.
- Other image files.
- Narration files.
- Other audio files.
- Text and title items.
- Transitions.

## Required media conversion engine

FFmpeg integration is mandatory, not optional. The application must not depend on WebView2 codec support as its complete media-format strategy.

- Unsupported or inconsistently supported input formats must be normalized automatically to an internal editing format.
- Required coverage includes WMV, MOV and other common iPhone media, MP4 variants, web video, and common audio formats.
- Conversion must run locally and must never alter the original source file.
- The application must announce when conversion starts, provide meaningful progress, announce completion or failure concisely, and keep keyboard focus stable.
- Controls that depend on converted media must remain unavailable until conversion is complete.
- Converted working files must be tracked separately from original source paths in the project model.
- FFmpeg must also provide the final composition and export engine.

## Initial project structure

A project should store references to its source files and a non-destructive description of the composition. Source files must not be altered when an item is trimmed, moved, muted, replaced, or removed from the project.

The project model should include:

- Project name and save location.
- Ordered project items.
- Source-media references.
- Item start times and durations.
- Trim and removal ranges.
- Audio placement and timing.
- Text content and presentation settings.
- Transitions.
- Export settings.
- Undo and redo history.

## Accessibility requirements

- All authoring tasks must be possible with a keyboard and screen reader.
- The ordered item list must provide the complete project structure without requiring interpretation of a visual timeline.
- Focus must remain stable after adding, moving, editing, or removing an item.
- Status announcements must be concise and must not interrupt playback unnecessarily.
- Playback position must be a first-class control that can be read, changed, and used as an insertion point.
- Commands must have discoverable controls and documented keyboard shortcuts.
- Destructive actions must provide clear confirmation or a reliable undo action.
- The interface must use native semantics and meaningful names, roles, states, headings, and status messages.
- Instructions intended for the public should refer to screen readers rather than one specific product.
- The editor should support focused keyboard operation without making the screen reader's browse mode the only way to reach important controls.

## Screen-reader visual authoring

Blind authors must be able to understand and control the visual canvas without treating the visual preview as the interface. This requirement applies to text overlays, separate title cards, still images with exact durations, transitions, captions, and future layered visual elements.

Every visual element must expose:

- Element type, text, or filename.
- Start time, end time, and duration.
- Horizontal position as a named preset and exact percentage.
- Vertical position as a named preset and exact percentage.
- Width, height, scale, and cropping.
- Layer order and relationships to other elements.
- Entrance and exit transitions.
- Detected overlap with other inserted elements or underlying video content.
- Whether any part extends beyond the visible frame.

Required position presets include Top Left, Top Center, Top Right, Center, Bottom Left, Bottom Center, and Bottom Right. Exact positioning must also be available. Keyboard commands must support moving an element left, right, up, and down; changing its size; and moving it forward or backward in the layer order.

The application must provide a Describe Current Frame action and a Check for Visual Conflicts action. Conflict checking should inspect the frames covered by the element and warn about likely overlap with faces, captions, existing text, dialog boxes, controls, cursor activity, other inserted elements, and high-detail or rapidly changing regions. The application may recommend a safer position, but it must not move the element without the user's permission.

Example announcement:

"Text overlay. Accessibility defect demonstrated. Begins at 00:00:12.000. Duration 8 seconds. Bottom center. Width 60 percent. In front of video. Possible overlap with existing captions."

Title cards and still images must expose their complete layout, including background, text alignment, image scaling, cropping, and unused space. These capabilities belong on the composition roadmap after dependable media normalization, single-media editing, immediate edited review, Undo, and export-format selection are working.

## Useful work already present in the supplied prototype

The supplied Accessible Video Suite prototype contains implementation that may be retained or adapted:

- FastAPI application structure.
- Media upload and format normalization.
- Keyboard-controlled playback.
- Precise time navigation and In and Out marks.
- Non-destructive removal segments.
- Mute-range export.
- Media-library upload and listing.
- Dialog-replacement data and FFmpeg processing.
- Title-card authoring controls.
- Background export jobs with progress and estimated time remaining.
- MP4, MP3, and WAV output handling.
- Play and download actions for completed exports.

The prototype currently edits one primary media file. It does not yet implement the ordered, multi-item composition model defined above.

## Prototype issues to resolve before building on it

- The supplied ZIP files are only parts of a project and do not contain all expected supporting files.
- The older console entry point contains an indentation error and should not be treated as the primary application.
- Product naming and version information are inconsistent across the repository, server, and templates.
- Several source files contain development anchors and recovery copies that must be reviewed before consolidation.
- The web template contains phase-specific testing instructions that should move into testing documentation.
- Project saving and reopening are not implemented.
- Title cards exist in the interface, but the current export data model does not establish full title-card rendering as part of a multi-item composition.
- The prototype uses one large server module and one very large editor template. These should be separated carefully after behavior is documented and protected by tests.

## Recommended first development slice

The first Media Editor build should prove the accessible composition model before adding advanced transitions or a complex visual timeline.

### First-build workflow

1. Create a new project.
2. Add two or more video or image items.
3. Read the ordered project-item list with a screen reader.
4. Insert an item before or after the current item.
5. Move an item earlier or later.
6. Set the duration of an image.
7. Add an audio file to one item.
8. Preview the project in sequence.
9. Save and reopen the project.
10. Export the composition as one MP4.

### First-build exclusions

- Advanced visual transitions.
- Multiple simultaneous video layers.
- Complex visual effects.
- Collaborative editing.
- Automated transcription or audio description.
- Full ScreenCapture Pro integration.

Those features can follow after the ordered composition workflow has been tested successfully with screen-reader users.

## Immediate next steps

- Add the remaining files from the existing application folder so the current prototype can be reconstructed without guessing.
- Consolidate the supplied pieces into one working source tree.
- Record the current routes, controls, shortcuts, and export behavior before refactoring.
- Define the project-file format and ordered project-item data model.
- Build the first accessible Project Items interface on top of that model.
- Convert Tanja's reference workflow into an end-to-end acceptance test.
