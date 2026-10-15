#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

mod native_media_picker;

#[derive(Serialize)]
struct OpenProjectResult { path: String, content: String }

#[derive(Deserialize, Clone)]
struct EditSegment { start: f64, end: f64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductionItem {
    source: String,
    segments: Vec<EditSegment>,
    media_kind: String,
    track_target: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackReplacement {
    source: String,
    segments: Vec<EditSegment>,
    media_kind: String,
    track_target: String,
    timeline_start: f64,
    timeline_end: f64,
}

fn app_folder(name: &str) -> Option<std::path::PathBuf> {
    let path = dirs::document_dir()?.join("Accessible Media Editor").join(name);
    fs::create_dir_all(&path).ok()?;
    Some(path)
}

#[tauri::command]
fn pick_media_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    native_media_picker::pick_media_files(&app)
}

#[tauri::command]
fn open_project_dialog(window: tauri::WebviewWindow) -> Result<Option<OpenProjectResult>, String> {
    let mut dialog = rfd::FileDialog::new().set_parent(&window).set_title("Open Project - Select an AMEPROJECT file, not a media file").add_filter("Accessible Media Editor project", &["ameproject"]);
    if let Some(folder) = app_folder("Projects") { dialog = dialog.set_directory(folder); }
    let Some(path) = dialog.pick_file() else { return Ok(None); };
    if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("ameproject")) != Some(true) {
        return Err("That is not an Accessible Media Editor project. Use Ctrl+O to open video, audio, or images.".into());
    }
    let content = fs::read_to_string(&path).map_err(|_| "The project could not be read as an Accessible Media Editor project. Use Ctrl+O to open media.".to_string())?;
    Ok(Some(OpenProjectResult { path: path.to_string_lossy().into_owned(), content }))
}

#[tauri::command]
fn save_project_dialog(window: tauri::WebviewWindow, suggested_name: String, content: String) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_parent(&window).set_title("Save Accessible Media Editor Project").set_file_name(&suggested_name).add_filter("Accessible Media Editor project", &["ameproject"]);
    if let Some(folder) = app_folder("Projects") { dialog = dialog.set_directory(folder); }
    let Some(path) = dialog.save_file() else { return Ok(None); };
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn write_project(path: String, content: String) -> Result<String, String> {
    fs::write(&path, content).map_err(|error| error.to_string())?; Ok(path)
}

#[tauri::command]
async fn export_edited_media(app: tauri::AppHandle, window: tauri::WebviewWindow, source: String, suggested_name: String, format: String) -> Result<Option<String>, String> {
    let extension = match format.to_ascii_lowercase().as_str() { "mov" => "mov", "webm" => "webm", "mp3" => "mp3", "wav" => "wav", "m4a" => "m4a", _ => "mp4" };
    let mut dialog = rfd::FileDialog::new().set_parent(&window).set_title("Save Edited Media").set_file_name(&suggested_name).add_filter("Edited media", &[extension]);
    if let Some(folder) = app_folder("Exports") { dialog = dialog.set_directory(folder); }
    let Some(path) = dialog.save_file() else { return Ok(None); };
    if extension == "mp4" { fs::copy(&source, &path).map_err(|error| error.to_string())?; }
    else {
        let output = path.to_string_lossy().into_owned();
        let args: Vec<String> = match extension {
            "mov" => vec!["-y".into(), "-i".into(), source, "-c".into(), "copy".into(), output],
            "webm" => vec!["-y".into(), "-i".into(), source, "-c:v".into(), "libvpx-vp9".into(), "-crf".into(), "30".into(), "-b:v".into(), "0".into(), "-c:a".into(), "libopus".into(), output],
            "mp3" => vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "libmp3lame".into(), "-q:a".into(), "2".into(), output],
            "wav" => vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "pcm_s16le".into(), output],
            "m4a" => vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), output],
            _ => unreachable!(),
        };
        run_ffmpeg(&app, args).await?;
    }
    if !path.is_file() { return Err("The export process completed, but the saved file could not be verified.".into()); }
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn open_projects_folder() -> Result<(), String> {
    let folder = app_folder("Projects").ok_or("The Projects folder could not be created.")?;
    std::process::Command::new("explorer").arg(folder).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_exports_folder() -> Result<(), String> {
    let folder = app_folder("Exports").ok_or("The Exports folder could not be created.")?;
    std::process::Command::new("explorer").arg(folder).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| error.to_string())
}

fn segment_filter(segments: &[EditSegment], with_video: bool, with_audio: bool) -> String {
    let mut parts = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if with_video { parts.push(format!("[0:v:0]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS[v{}]", segment.start, segment.end, index)); }
        if with_audio { parts.push(format!("[0:a:0]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS[a{}]", segment.start, segment.end, index)); }
    }
    let inputs = (0..segments.len()).map(|index| {
        format!("{}{}", if with_video { format!("[v{}]", index) } else { String::new() }, if with_audio { format!("[a{}]", index) } else { String::new() })
    }).collect::<String>();
    parts.push(format!("{}concat=n={}:v={}:a={}{}", inputs, segments.len(), if with_video { 1 } else { 0 }, if with_audio { 1 } else { 0 }, if with_video && with_audio { "[v][a]" } else if with_video { "[v]" } else { "[a]" }));
    parts.join(";")
}

async fn run_ffmpeg(app: &tauri::AppHandle, args: Vec<String>) -> Result<(), String> {
    let output = app.shell().sidecar("ffmpeg").map_err(|error| error.to_string())?.args(args).output().await.map_err(|error| error.to_string())?;
    if output.status.success() { Ok(()) } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" "))
    }
}

fn safe_working_path(item_id: &str, extension: &str, purpose: &str) -> Result<std::path::PathBuf, String> {
    let folder = dirs::data_local_dir().ok_or("The local application data folder is unavailable.")?.join("Accessible Media Editor").join("Working");
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let safe_id: String = item_id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-').collect();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    Ok(folder.join(format!("{}-{}-{}.{}", if safe_id.is_empty() { "media" } else { &safe_id }, purpose, stamp, extension)))
}

#[tauri::command]
async fn normalize_media(app: tauri::AppHandle, source: String, media_kind: String, item_id: String) -> Result<String, String> {
    let audio_only = media_kind.eq_ignore_ascii_case("audio");
    let output_path = safe_working_path(&item_id, if audio_only { "m4a" } else { "mp4" }, "normalized")?;
    let output_text = output_path.to_string_lossy().into_owned();
    let args = if audio_only {
        vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), output_text.clone()]
    } else {
        vec!["-y".into(), "-i".into(), source, "-map".into(), "0:v:0".into(), "-map".into(), "0:a:0?".into(), "-vf".into(), "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=nv12".into(), "-c:v".into(), "h264_mf".into(), "-rate_control".into(), "quality".into(), "-quality".into(), "80".into(), "-hw_encoding".into(), "0".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), "-movflags".into(), "+faststart".into(), output_text.clone()]
    };
    run_ffmpeg(&app, args).await?;
    Ok(output_text)
}

#[tauri::command]
async fn render_working_edit(app: tauri::AppHandle, source: String, segments: Vec<EditSegment>, media_kind: String, item_id: String) -> Result<String, String> {
    if segments.is_empty() { return Err("The edit contains no retained media.".into()); }
    let audio_only = media_kind.eq_ignore_ascii_case("audio");
    let output_path = safe_working_path(&item_id, if audio_only { "m4a" } else { "mp4" }, "edited")?;
    let output_text = output_path.to_string_lossy().into_owned();
    if audio_only {
        let filter = segment_filter(&segments, false, true);
        run_ffmpeg(&app, vec!["-y".into(), "-i".into(), source, "-filter_complex".into(), filter, "-map".into(), "[a]".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), output_text.clone()]).await?;
    } else {
        let filter = segment_filter(&segments, true, true);
        let args = vec!["-y".into(), "-i".into(), source.clone(), "-filter_complex".into(), filter, "-map".into(), "[v]".into(), "-map".into(), "[a]".into(), "-c:v".into(), "h264_mf".into(), "-pix_fmt".into(), "nv12".into(), "-rate_control".into(), "quality".into(), "-quality".into(), "80".into(), "-hw_encoding".into(), "0".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), "-movflags".into(), "+faststart".into(), output_text.clone()];
        if run_ffmpeg(&app, args).await.is_err() {
            let filter = segment_filter(&segments, true, false);
            run_ffmpeg(&app, vec!["-y".into(), "-i".into(), source, "-filter_complex".into(), filter, "-map".into(), "[v]".into(), "-c:v".into(), "h264_mf".into(), "-pix_fmt".into(), "nv12".into(), "-rate_control".into(), "quality".into(), "-quality".into(), "80".into(), "-hw_encoding".into(), "0".into(), "-movflags".into(), "+faststart".into(), output_text.clone()]).await?;
        }
    }
    Ok(output_text)
}

fn segment_duration(segments: &[EditSegment]) -> f64 {
    segments.iter().map(|segment| (segment.end - segment.start).max(0.0)).sum()
}

fn standard_video_filter(segments: &[EditSegment], with_audio: bool) -> String {
    let base = segment_filter(segments, true, with_audio);
    if with_audio {
        format!("{};[v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=nv12[vo];[a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ao]", base)
    } else {
        format!("{};[v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=nv12[vo]", base)
    }
}

fn standard_audio_filter(segments: &[EditSegment]) -> String {
    format!("{};[a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ao]", segment_filter(segments, false, true))
}

fn standard_video_encoding(output: String) -> Vec<String> {
    vec!["-c:v".into(), "h264_mf".into(), "-pix_fmt".into(), "nv12".into(), "-rate_control".into(), "quality".into(), "-quality".into(), "80".into(), "-hw_encoding".into(), "0".into(), "-r".into(), "30".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), "-ar".into(), "48000".into(), "-ac".into(), "2".into(), "-movflags".into(), "+faststart".into(), output]
}

async fn render_production_item(app: &tauri::AppHandle, item: &ProductionItem, output: &std::path::Path) -> Result<(), String> {
    if item.segments.is_empty() { return Err("A production item contains no retained media.".into()); }
    let duration = segment_duration(&item.segments);
    if duration <= 0.0 { return Err("A production item has no playable duration.".into()); }
    let output_text = output.to_string_lossy().into_owned();
    if item.media_kind.eq_ignore_ascii_case("audio") || item.track_target.eq_ignore_ascii_case("audio") {
        let filter = standard_audio_filter(&item.segments);
        let mut args = vec!["-y".into(), "-i".into(), item.source.clone(), "-f".into(), "lavfi".into(), "-i".into(), "color=c=black:s=1280x720:r=30".into(), "-filter_complex".into(), filter, "-map".into(), "1:v:0".into(), "-map".into(), "[ao]".into(), "-t".into(), format!("{:.6}", duration)];
        args.extend(standard_video_encoding(output_text));
        return run_ffmpeg(app, args).await;
    }
    if item.track_target.eq_ignore_ascii_case("video") {
        let filter = standard_video_filter(&item.segments, false);
        let mut args = vec!["-y".into(), "-i".into(), item.source.clone(), "-f".into(), "lavfi".into(), "-i".into(), "anullsrc=r=48000:cl=stereo".into(), "-filter_complex".into(), filter, "-map".into(), "[vo]".into(), "-map".into(), "1:a:0".into(), "-t".into(), format!("{:.6}", duration)];
        args.extend(standard_video_encoding(output_text));
        return run_ffmpeg(app, args).await;
    }
    let filter = standard_video_filter(&item.segments, true);
    let mut args = vec!["-y".into(), "-i".into(), item.source.clone(), "-filter_complex".into(), filter, "-map".into(), "[vo]".into(), "-map".into(), "[ao]".into()];
    args.extend(standard_video_encoding(output_text.clone()));
    if run_ffmpeg(app, args).await.is_ok() { return Ok(()); }
    let filter = standard_video_filter(&item.segments, false);
    let mut silent_args = vec!["-y".into(), "-i".into(), item.source.clone(), "-f".into(), "lavfi".into(), "-i".into(), "anullsrc=r=48000:cl=stereo".into(), "-filter_complex".into(), filter, "-map".into(), "[vo]".into(), "-map".into(), "1:a:0".into(), "-t".into(), format!("{:.6}", duration)];
    silent_args.extend(standard_video_encoding(output_text));
    run_ffmpeg(app, silent_args).await
}

#[tauri::command]
async fn render_production(app: tauri::AppHandle, window: tauri::WebviewWindow, items: Vec<ProductionItem>, replacements: Vec<TrackReplacement>, project_id: String) -> Result<String, String> {
    if items.is_empty() { return Err("The production contains no media to render.".into()); }
    let mut intermediates = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let path = safe_working_path(&format!("{}-{}", project_id, index + 1), "mp4", "production-item")?;
        window.emit("production-render-progress", format!("Rendering production item {} of {}.", index + 1, items.len())).map_err(|error| error.to_string())?;
        if let Err(error) = render_production_item(&app, item, &path).await {
            for previous in &intermediates { let _ = fs::remove_file(previous); }
            let _ = fs::remove_file(&path);
            return Err(format!("Item {} could not be rendered. {}", index + 1, error));
        }
        intermediates.push(path);
    }
    window.emit("production-render-progress", "Joining rendered production items.").map_err(|error| error.to_string())?;
    let base_path = safe_working_path(&project_id, "mp4", "production-base")?;
    let base_text = base_path.to_string_lossy().into_owned();
    let mut args = vec!["-y".into()];
    for path in &intermediates { args.push("-i".into());args.push(path.to_string_lossy().into_owned()); }
    let inputs = (0..intermediates.len()).map(|index| format!("[{}:v:0][{}:a:0]", index, index)).collect::<String>();
    args.extend(["-filter_complex".into(), format!("{}concat=n={}:v=1:a=1[v][a]", inputs, intermediates.len()), "-map".into(), "[v]".into(), "-map".into(), "[a]".into()]);
    args.extend(standard_video_encoding(base_text.clone()));
    let result = run_ffmpeg(&app, args).await;
    for path in &intermediates { let _ = fs::remove_file(path); }
    result?;
    if replacements.is_empty() { return Ok(base_text); }

    let mut replacement_paths = Vec::new();
    for (index, replacement) in replacements.iter().enumerate() {
        window.emit("production-render-progress", format!("Rendering track replacement {} of {}.", index + 1, replacements.len())).map_err(|error| error.to_string())?;
        let path = safe_working_path(&format!("{}-replacement-{}", project_id, index + 1), "mp4", "track")?;
        let item = ProductionItem { source: replacement.source.clone(), segments: replacement.segments.clone(), media_kind: replacement.media_kind.clone(), track_target: replacement.track_target.clone() };
        if let Err(error) = render_production_item(&app, &item, &path).await {
            let _ = fs::remove_file(&base_path);
            for previous in &replacement_paths { let _ = fs::remove_file(previous); }
            return Err(format!("Track replacement {} could not be rendered. {}", index + 1, error));
        }
        replacement_paths.push(path);
    }

    window.emit("production-render-progress", "Applying audio and video track replacements.").map_err(|error| error.to_string())?;
    let output_path = safe_working_path(&project_id, "mp4", "production")?;
    let output_text = output_path.to_string_lossy().into_owned();
    let mut compose_args = vec!["-y".into(), "-i".into(), base_text.clone()];
    for path in &replacement_paths { compose_args.push("-i".into()); compose_args.push(path.to_string_lossy().into_owned()); }
    let mut filters = vec!["[0:v:0]setpts=PTS-STARTPTS[v0]".to_string(), "[0:a:0]asetpts=PTS-STARTPTS[a0]".to_string()];
    let mut video_label = "v0".to_string();
    let mut audio_label = "a0".to_string();
    let mut video_count = 0;
    let mut audio_count = 0;
    for (index, replacement) in replacements.iter().enumerate() {
        let input = index + 1;
        let start = replacement.timeline_start.max(0.0);
        let end = replacement.timeline_end.max(start);
        let length = end - start;
        if replacement.track_target.eq_ignore_ascii_case("video") || replacement.track_target.eq_ignore_ascii_case("both") {
            video_count += 1;
            filters.push(format!("[{}:v:0]trim=duration={:.6},setpts=PTS-STARTPTS+{:.6}/TB[rv{}]", input, length, start, video_count));
            filters.push(format!("[{}][rv{}]overlay=eof_action=pass:enable='between(t,{:.6},{:.6})'[v{}]", video_label, video_count, start, end, video_count));
            video_label = format!("v{}", video_count);
        }
        if replacement.track_target.eq_ignore_ascii_case("audio") || replacement.track_target.eq_ignore_ascii_case("both") {
            audio_count += 1;
            let delay = (start * 1000.0).round() as u64;
            filters.push(format!("[{}]volume=enable='between(t,{:.6},{:.6})':volume=0[ma{}]", audio_label, start, end, audio_count));
            filters.push(format!("[{}:a:0]atrim=duration={:.6},asetpts=PTS-STARTPTS,adelay={}|{}[ra{}]", input, length, delay, delay, audio_count));
            filters.push(format!("[ma{}][ra{}]amix=inputs=2:duration=first:normalize=0[a{}]", audio_count, audio_count, audio_count));
            audio_label = format!("a{}", audio_count);
        }
    }
    compose_args.extend(["-filter_complex".into(), filters.join(";"), "-map".into(), format!("[{}]", video_label), "-map".into(), format!("[{}]", audio_label)]);
    compose_args.extend(standard_video_encoding(output_text.clone()));
    let compose_result = run_ffmpeg(&app, compose_args).await;
    let _ = fs::remove_file(&base_path);
    for path in &replacement_paths { let _ = fs::remove_file(path); }
    compose_result?;
    Ok(output_text)
}

fn item(app: &tauri::AppHandle, label: &str, id: &str) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::new(label).id(id).build(app)
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&item(app,"Open Media... Ctrl+O","importMedia")?)
        .item(&item(app,"Export Complete Production... Ctrl+E","exportMedia")?)
        .separator().item(&item(app,"New Project Ctrl+N","newProject")?).item(&item(app,"Open Project... Ctrl+Shift+O","openProject")?)
        .item(&item(app,"Save Project Ctrl+S","saveProject")?).item(&item(app,"Save Project As... Ctrl+Shift+S","saveProjectAs")?)
        .item(&item(app,"Open Projects Folder","openProjectsFolder")?).item(&item(app,"Open Exports Folder","openExportsFolder")?).separator().item(&item(app,"Exit","exitApp")?).build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app,"Undo Ctrl+Z","undo")?).item(&item(app,"Redo Ctrl+Y","redo")?)
        .item(&item(app,"Copy Source Selection Ctrl+C","copyMedia")?).item(&item(app,"Paste Replace on Target Track Ctrl+V","pasteMedia")?)
        .item(&item(app,"Paste Insert into Sequence Ctrl+Shift+V","pasteInsert")?)
        .separator().item(&item(app,"Apply Bracketed Edit Ctrl+Delete","trimPrimary")?).item(&item(app,"Split at Playhead Ctrl+K","split")?).item(&item(app,"Remove Selected Item Delete","removeItem")?).build()?;
    let insert = SubmenuBuilder::new(app, "Insert")
        .item(&item(app,"Media... Ctrl+O","importMedia")?).item(&item(app,"Text...","addText")?)
        .item(&item(app,"Crossfade Transition","addTransition")?).build()?;
    let project = SubmenuBuilder::new(app, "Project")
        .item(&item(app,"Item Properties Alt+Enter","properties")?).item(&item(app,"Make Selected Source Primary","makeSourcePrimary")?).separator()
        .item(&item(app,"Go to Exact Time... Ctrl+G","goToTime")?).item(&item(app,"Set Left Bracket [","setIn")?).item(&item(app,"Set Right Bracket ]","setOut")?).separator()
        .item(&item(app,"Move Earlier Ctrl+Up","moveEarlier")?).item(&item(app,"Move Later Ctrl+Down","moveLater")?).build()?;
    let playback = SubmenuBuilder::new(app, "Playback")
        .item(&item(app,"Play or Pause X","playPause")?).item(&item(app,"Audition Selection or From Playhead Space","audition")?).separator()
        .item(&item(app,"Scrub Back 1 Second U","scrubBack1")?).item(&item(app,"Scrub Forward 1 Second I","scrubForward1")?)
        .item(&item(app,"Scrub Back 100 Milliseconds Shift+U","scrubBack100ms")?).item(&item(app,"Scrub Forward 100 Milliseconds Shift+I","scrubForward100ms")?)
        .item(&item(app,"Scrub Back 10 Milliseconds Ctrl+Alt+U","scrubBack10ms")?).item(&item(app,"Scrub Forward 10 Milliseconds Ctrl+Alt+I","scrubForward10ms")?)
        .separator().item(&item(app,"Move Back 5 Seconds Left Arrow","moveBack5")?).item(&item(app,"Move Forward 5 Seconds Right Arrow","moveForward5")?)
        .item(&item(app,"Move Back 30 Seconds Shift+Left","moveBack30")?).item(&item(app,"Move Forward 30 Seconds Shift+Right","moveForward30")?)
        .item(&item(app,"Move Back 5 Minutes J","moveBack300")?).item(&item(app,"Move Forward 5 Minutes L","moveForward300")?)
        .item(&item(app,"Move Back 1 Millisecond Alt+Left","nudgeBack")?).item(&item(app,"Move Forward 1 Millisecond Alt+Right","nudgeForward")?)
        .item(&item(app,"Jump to Beginning Home","jumpBeginning")?).item(&item(app,"Jump to End End","jumpEnd")?).separator()
        .item(&item(app,"Target Both Audio and Video B","targetBoth")?).item(&item(app,"Target Video Only V","targetVideo")?).item(&item(app,"Target Audio Only A","targetAudio")?).build()?;
    let navigate = SubmenuBuilder::new(app, "Navigate")
        .item(&item(app,"Media Editor Workspace","showMediaWorkspace")?).item(&item(app,"AudioStudio Pro Workspace","showAudioWorkspace")?)
        .item(&item(app,"Next Workspace Ctrl+Tab","nextWorkspace")?).item(&item(app,"Previous Workspace Ctrl+Shift+Tab","previousWorkspace")?).separator()
        .item(&item(app,"Previous Section Ctrl+Page Up","previousSection")?).item(&item(app,"Next Section Ctrl+Page Down","nextSection")?)
        .separator().item(&item(app,"Open Media List","focusProjectItems")?).item(&item(app,"Playhead","focusPlayhead")?).build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(app,"Testing Guide","showTestingGuide")?).item(&item(app,"Keyboard Shortcuts","showShortcuts")?).item(&item(app,"Toggle Sound Cues","toggleSoundCues")?)
        .item(&item(app,"About Accessible Media Editor","showAbout")?).build()?;
    MenuBuilder::new(app).items(&[&file,&edit,&insert,&project,&playback,&navigate,&help]).build()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let _ = app_folder("Projects");
            let _ = app_folder("Exports");
            if let Some(window)=app.get_webview_window("main") { window.set_menu(build_menu(app.handle())?)?; }
            app.on_menu_event(|app,event| {
                let action=event.id.as_ref();
                if action=="exitApp" { app.exit(0); return; }
                if let Some(window)=app.get_webview_window("main") { let _=window.emit("menu-action",action); }
            }); Ok(())
        })
        .invoke_handler(tauri::generate_handler![pick_media_files,open_project_dialog,save_project_dialog,write_project,export_edited_media,open_projects_folder,open_exports_folder,set_window_title,normalize_media,render_working_edit,render_production])
        .run(tauri::generate_context!())
        .expect("error while running Accessible Media Editor");
}
