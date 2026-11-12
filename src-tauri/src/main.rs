#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
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
    #[serde(default)] label: String,
    source: String,
    segments: Vec<EditSegment>,
    media_kind: String,
    track_target: String,
    #[serde(default = "default_audio_volume")] audio_volume: f64,
    #[serde(default)] transition_type: String,
    #[serde(default)] transition_duration: f64,
    #[serde(default)] attached_audio_source: String,
    #[serde(default)] opening_effect_type: String,
    #[serde(default)] opening_effect_duration: f64,
    #[serde(default)] closing_effect_type: String,
    #[serde(default)] closing_effect_duration: f64,
}
fn default_audio_volume() -> f64 { 1.0 }

fn human_utc_timestamp() -> String {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = elapsed.as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096).div_euclid(365);
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2).div_euclid(153);
    let day = day_of_year - (153 * month_part + 2).div_euclid(5) + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    if month <= 2 { year += 1; }
    let hour = day_seconds / 3_600;
    let minute = day_seconds % 3_600 / 60;
    let second = day_seconds % 60;
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03} UTC", year, month, day, hour, minute, second, elapsed.subsec_millis())
}

fn human_duration(seconds: f64) -> String {
    let total = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = total / 3_600_000;
    let minutes = total / 60_000 % 60;
    let whole_seconds = total / 1_000 % 60;
    let milliseconds = total % 1_000;
    let mut parts = Vec::new();
    if hours > 0 { parts.push(format!("{} {}", hours, if hours == 1 { "hour" } else { "hours" })); }
    if minutes > 0 { parts.push(format!("{} {}", minutes, if minutes == 1 { "minute" } else { "minutes" })); }
    parts.push(format!("{} {}", whole_seconds, if whole_seconds == 1 { "second" } else { "seconds" }));
    if milliseconds > 0 { parts.push(format!("{} {}", milliseconds, if milliseconds == 1 { "millisecond" } else { "milliseconds" })); }
    parts.join(", ")
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuckRange { start: f64, end: f64 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundMusic {
    source: String,
    volume: f64,
    duck_factor: f64,
    duck_ranges: Vec<DuckRange>,
}

fn app_folder(name: &str) -> Option<std::path::PathBuf> {
    let path = dirs::document_dir()?.join("Accessible Media Editor").join(name);
    fs::create_dir_all(&path).ok()?;
    Some(path)
}

fn write_startup_log(message: &str) {
    let Some(folder) = app_folder("Logs") else { return; };
    let path = folder.join("StartupLog.txt");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {}", human_utc_timestamp(), message);
    }
}

#[tauri::command]
fn save_title_slide_image(data_url: String) -> Result<String, String> {
    let encoded=data_url.strip_prefix("data:image/png;base64,").ok_or("Expected a PNG image.")?;
    if encoded.len()>12_000_000 {return Err("Title image is too large.".into());}
    use base64::Engine;
    let bytes=base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|error|error.to_string())?;
    if !bytes.starts_with(&[137,80,78,71,13,10,26,10]) {return Err("Invalid PNG data.".into());}
    let folder=app_folder("Library").ok_or("Unable to access media library.")?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error|error.to_string())?.as_nanos();
    let path=folder.join(format!("TitleSlide-{}.png",stamp));
    fs::write(&path,bytes).map_err(|error|error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn log_frontend_startup(message: String) {
    write_startup_log(&message);
}

#[tauri::command]
fn frontend_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    write_startup_log("Frontend reported ready. The native application window is already visible.");
    window.set_focus().map_err(|error| {
        let message = format!("Application window could not receive focus: {}", error);
        write_startup_log(&message);
        message
    })?;
    write_startup_log("Frontend workspace focused.");
    Ok(())
}

#[tauri::command]
fn pick_media_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    // Restore the known-working 0.10.21 Windows media picker, including
    // multi-selection and its File Name clipboard handling.
    write_startup_log("Open Media: invoking restored 0.10.21 picker.");
    let result = native_media_picker::pick_media_files(&app);
    match &result {
        Ok(paths) => write_startup_log(&format!("Open Media: picker returned {} file(s).", paths.len())),
        Err(error) => write_startup_log(&format!("Open Media: picker error: {}", error)),
    }
    result
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
fn open_project_path(path: String) -> Result<OpenProjectResult, String> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("ameproject")) != Some(true) {
        return Err("That is not an Accessible Media Editor project.".into());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("The project could not be read: {}", error))?;
    Ok(OpenProjectResult { path: path.to_string_lossy().into_owned(), content })
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
fn read_recovery_session() -> Result<Option<String>, String> {
    let folder = app_folder("Sessions").ok_or("Session folder unavailable")?;
    let path = folder.join("LastSession.json");
    if !path.exists() { return Ok(None); }
    fs::read_to_string(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_recovery_session(content: String) -> Result<(), String> {
    let folder = app_folder("Sessions").ok_or("Session folder unavailable")?;
    let target = folder.join("LastSession.json");
    let temporary = folder.join("LastSession.tmp");
    // Never replace the previous recoverable session with malformed JSON.
    let _: serde_json::Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    // Windows rename cannot replace an existing file. Keep a backup during replacement.
    let backup = folder.join("LastSession.backup.json");
    if target.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&target, &backup).map_err(|error| error.to_string())?;
    }
    match fs::rename(&temporary, &target) {
        Ok(()) => Ok(()),
        Err(error) => {
            if backup.exists() { let _ = fs::rename(&backup, &target); }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn read_media_library() -> Result<Option<String>, String> {
    let folder = app_folder("Library").ok_or("Library folder unavailable")?;
    let path = folder.join("MediaLibrary.json");
    if !path.exists() { return Ok(None); }
    fs::read_to_string(path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_media_library(content: String) -> Result<(), String> {
    let folder = app_folder("Library").ok_or("Library folder unavailable")?;
    let target = folder.join("MediaLibrary.json");
    let temporary = folder.join("MediaLibrary.tmp");
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    if value.get("schema").and_then(|v| v.as_u64()) != Some(1)
        || !value.get("items").map(|v| v.is_array()).unwrap_or(false) {
        return Err("Invalid media library schema".into());
    }
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    let backup = folder.join("MediaLibrary.backup.json");
    if target.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&target, &backup).map_err(|error| error.to_string())?;
    }
    match fs::rename(&temporary, &target) {
        Ok(()) => Ok(()),
        Err(error) => {
            if backup.exists() { let _ = fs::rename(&backup, &target); }
            Err(error.to_string())
        }
    }
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
    let file_stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("AccessibleMediaEditorExport");
    let temporary_path = path.with_file_name(format!("{}.ame-exporting.{}", file_stem, extension));
    let _ = fs::remove_file(&temporary_path);
    window.emit("production-render-progress", format!("Export destination selected. Converting complete production to {}. Please wait for Export Complete before using the file.", extension.to_ascii_uppercase())).map_err(|error| error.to_string())?;
    let export_result: Result<(), String> = if extension == "mp4" {
        fs::copy(&source, &temporary_path).map(|_| ()).map_err(|error| error.to_string())
    } else {
        let output = temporary_path.to_string_lossy().into_owned();
        let args: Vec<String> = match extension {
            "mov" => vec!["-y".into(), "-i".into(), source, "-c".into(), "copy".into(), output],
            "webm" => vec!["-y".into(), "-i".into(), source, "-c:v".into(), "libvpx-vp9".into(), "-crf".into(), "30".into(), "-b:v".into(), "0".into(), "-c:a".into(), "libopus".into(), output],
            "mp3" => vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "libmp3lame".into(), "-q:a".into(), "2".into(), output],
            "wav" => vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "pcm_s16le".into(), output],
            "m4a" => vec!["-y".into(), "-i".into(), source, "-vn".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), output],
            _ => unreachable!(),
        };
        run_ffmpeg(&app, args).await
    };
    if let Err(error) = export_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Export failed. No completed destination file was created. {}", error));
    }
    let verified = temporary_path.metadata().map(|metadata| metadata.is_file() && metadata.len() > 0).unwrap_or(false);
    if !verified {
        let _ = fs::remove_file(&temporary_path);
        return Err("Export verification failed. No completed destination file was created.".into());
    }
    if path.is_file() { fs::remove_file(&path).map_err(|error| format!("The completed temporary export is safe, but the existing destination could not be replaced. {}", error))?; }
    fs::rename(&temporary_path, &path).map_err(|error| format!("The completed temporary export could not be finalized. {}", error))?;
    if !path.is_file() { return Err("The export was finalized, but the completed destination file could not be verified.".into()); }
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
fn reveal_exported_file(path: String) -> Result<(), String> {
    let file = std::path::PathBuf::from(&path);
    if !file.is_file() { return Err("The saved export could not be found at that location.".into()); }
    std::process::Command::new("explorer").arg(format!("/select,{}", file.to_string_lossy())).spawn().map_err(|error| error.to_string())?;
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
        Err(stderr.lines().filter(|line| !line.trim().is_empty()).rev().take(40).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" "))
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

fn standard_video_filter(segments: &[EditSegment], with_audio: bool, audio_volume: f64) -> String {
    let base = segment_filter(segments, true, with_audio);
    if with_audio {
        format!("{};[v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=nv12[vo];[a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={:.6}[ao]", base,audio_volume.clamp(0.0,1.0))
    } else {
        format!("{};[v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=nv12[vo]", base)
    }
}

fn standard_audio_filter(segments: &[EditSegment],audio_volume:f64) -> String {
    format!("{};[a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={:.6}[ao]", segment_filter(segments, false, true),audio_volume.clamp(0.0,1.0))
}

fn standard_video_encoding(output: String) -> Vec<String> {
    vec!["-c:v".into(), "h264_mf".into(), "-pix_fmt".into(), "nv12".into(), "-rate_control".into(), "quality".into(), "-quality".into(), "80".into(), "-hw_encoding".into(), "0".into(), "-r".into(), "30".into(), "-c:a".into(), "aac".into(), "-b:a".into(), "192k".into(), "-ar".into(), "48000".into(), "-ac".into(), "2".into(), "-movflags".into(), "+faststart".into(), output]
}

async fn render_production_item(app: &tauri::AppHandle, item: &ProductionItem, output: &std::path::Path) -> Result<(), String> {
    if item.segments.is_empty() { return Err("A production item contains no retained media.".into()); }
    let duration = segment_duration(&item.segments);
    if duration <= 0.0 { return Err("A production item has no playable duration.".into()); }
    let output_text = output.to_string_lossy().into_owned();
    if item.media_kind.eq_ignore_ascii_case("image") {
        let filter = "[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=nv12[vo]";
        let mut args = vec!["-y".into(), "-loop".into(), "1".into(), "-i".into(), item.source.clone()];
        if item.attached_audio_source.is_empty() {
            args.extend(["-f".into(), "lavfi".into(), "-i".into(), "anullsrc=r=48000:cl=stereo".into()]);
        } else {
            args.extend(["-i".into(),item.attached_audio_source.clone()]);
        }
        args.extend(["-filter_complex".into(),filter.into(),"-map".into(),"[vo]".into(),"-map".into(),"1:a:0".into(),"-t".into(),format!("{:.6}",duration)]);
        args.extend(standard_video_encoding(output_text));
        return run_ffmpeg(app, args).await;
    }
    if item.media_kind.eq_ignore_ascii_case("audio") || item.track_target.eq_ignore_ascii_case("audio") {
        let filter = standard_audio_filter(&item.segments,item.audio_volume);
        let mut args = vec!["-y".into(), "-i".into(), item.source.clone(), "-f".into(), "lavfi".into(), "-i".into(), "color=c=black:s=1280x720:r=30".into(), "-filter_complex".into(), filter, "-map".into(), "1:v:0".into(), "-map".into(), "[ao]".into(), "-t".into(), format!("{:.6}", duration)];
        args.extend(standard_video_encoding(output_text));
        return run_ffmpeg(app, args).await;
    }
    if item.track_target.eq_ignore_ascii_case("video") {
        let filter = standard_video_filter(&item.segments, false,item.audio_volume);
        let mut args = vec!["-y".into(), "-i".into(), item.source.clone(), "-f".into(), "lavfi".into(), "-i".into(), "anullsrc=r=48000:cl=stereo".into(), "-filter_complex".into(), filter, "-map".into(), "[vo]".into(), "-map".into(), "1:a:0".into(), "-t".into(), format!("{:.6}", duration)];
        args.extend(standard_video_encoding(output_text));
        return run_ffmpeg(app, args).await;
    }
    let filter = standard_video_filter(&item.segments, true,item.audio_volume);
    let mut args = vec!["-y".into(), "-i".into(), item.source.clone(), "-filter_complex".into(), filter, "-map".into(), "[vo]".into(), "-map".into(), "[ao]".into()];
    args.extend(standard_video_encoding(output_text.clone()));
    if run_ffmpeg(app, args).await.is_ok() { return Ok(()); }
    let filter = standard_video_filter(&item.segments, false,item.audio_volume);
    let mut silent_args = vec!["-y".into(), "-i".into(), item.source.clone(), "-f".into(), "lavfi".into(), "-i".into(), "anullsrc=r=48000:cl=stereo".into(), "-filter_complex".into(), filter, "-map".into(), "[vo]".into(), "-map".into(), "1:a:0".into(), "-t".into(), format!("{:.6}", duration)];
    silent_args.extend(standard_video_encoding(output_text));
    run_ffmpeg(app, silent_args).await
}

#[tauri::command]
async fn render_production(app: tauri::AppHandle, window: tauri::WebviewWindow, items: Vec<ProductionItem>, replacements: Vec<TrackReplacement>, background_music: Option<BackgroundMusic>, project_id: String) -> Result<String, String> {
    if items.is_empty() { return Err("The production contains no media to render.".into()); }
    write_startup_log(&format!("Presentation render started for {} with {} items.", project_id, items.len()));
    for (index,item) in items.iter().enumerate() {
        let name=if item.label.trim().is_empty(){format!("Item {}",index+1)}else{item.label.clone()};
        if !std::path::Path::new(&item.source).is_file(){let message=format!("Presentation item {} of {}, {}, cannot be rendered because its source file was not found: {}",index+1,items.len(),name,item.source);write_startup_log(&message);return Err(message);}
        if !item.attached_audio_source.is_empty()&&!std::path::Path::new(&item.attached_audio_source).is_file(){let message=format!("Presentation item {} of {}, {}, cannot be rendered because its attached audio file was not found: {}",index+1,items.len(),name,item.attached_audio_source);write_startup_log(&message);return Err(message);}
    }
    let mut intermediates = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let path = safe_working_path(&format!("{}-{}", project_id, index + 1), "mp4", "production-item")?;
        let name=if item.label.trim().is_empty(){format!("Item {}",index+1)}else{item.label.clone()};
        let progress=format!("Rendering presentation item {} of {}, {}. Duration {}.",index+1,items.len(),name,human_duration(segment_duration(&item.segments)));
        write_startup_log(&progress);window.emit("production-render-progress",progress).map_err(|error| error.to_string())?;
        if let Err(error) = render_production_item(&app, item, &path).await {
            for previous in &intermediates { let _ = fs::remove_file(previous); }
            let _ = fs::remove_file(&path);
            let message=format!("Presentation item {} of {}, {}, could not be rendered. {}",index+1,items.len(),name,error);write_startup_log(&message);return Err(message);
        }
        write_startup_log(&format!("Presentation item {} of {}, {}, finished rendering.",index+1,items.len(),name));
        intermediates.push(path);
    }
    window.emit("production-render-progress", "Joining rendered production items.").map_err(|error| error.to_string())?;
    let base_path = safe_working_path(&project_id, "mp4", "production-base")?;
    let base_text = base_path.to_string_lossy().into_owned();
    let mut args = vec!["-y".into()];
    for path in &intermediates { args.push("-i".into());args.push(path.to_string_lossy().into_owned()); }
    let mut filter_parts=Vec::new();
    for index in 0..items.len(){
        filter_parts.push(format!("[{}:v:0]fps=30,scale=1280:720,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[vin{}]",index,index));
        filter_parts.push(format!("[{}:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[ain{}]",index,index));
    }
    let mut video_label="[vin0]".to_string();let mut audio_label="[ain0]".to_string();let mut joined_duration=segment_duration(&items[0].segments);
    for index in 1..items.len(){let nv=format!("[vin{}]",index);let na=format!("[ain{}]",index);let ov=format!("[v{}]",index);let oa=format!("[a{}]",index);let kind=items[index].transition_type.to_ascii_lowercase();let effect=match kind.as_str(){"crossfade"=>Some("fade"),"fadeblack"=>Some("fadeblack"),"fadewhite"=>Some("fadewhite"),"wipeleft"=>Some("wipeleft"),"wiperight"=>Some("wiperight"),_=>None};let requested=if effect.is_some(){items[index].transition_duration.max(0.0)}else{0.0};let next_duration=segment_duration(&items[index].segments);let transition=requested.min(joined_duration).min(next_duration);if transition>0.0005{let offset=(joined_duration-transition).max(0.0);filter_parts.push(format!("{}{}xfade=transition={}:duration={:.6}:offset={:.6}{}",video_label,nv,effect.unwrap_or("fade"),transition,offset,ov));filter_parts.push(format!("{}{}acrossfade=d={:.6}:c1=tri:c2=tri{}",audio_label,na,transition,oa));joined_duration+=next_duration-transition;}else{filter_parts.push(format!("{}{}concat=n=2:v=1:a=0{}",video_label,nv,ov));filter_parts.push(format!("{}{}concat=n=2:v=0:a=1{}",audio_label,na,oa));joined_duration+=next_duration;}video_label=ov;audio_label=oa;}
    if items.len()==1{filter_parts.push("[0:v:0]null[vjoined]".into());filter_parts.push("[0:a:0]anull[ajoined]".into());}else{filter_parts.push(format!("{}null[vjoined]",video_label));filter_parts.push(format!("{}anull[ajoined]",audio_label));}
    let opening=&items[0];let closing=&items[items.len()-1];
    let opening_color=match opening.opening_effect_type.to_ascii_lowercase().as_str(){"fadeblack"=>Some("black"),"fadewhite"=>Some("white"),_=>None};
    let closing_color=match closing.closing_effect_type.to_ascii_lowercase().as_str(){"fadeblack"=>Some("black"),"fadewhite"=>Some("white"),_=>None};
    let opening_duration=if opening_color.is_some(){opening.opening_effect_duration.max(0.0)}else{0.0};
    let closing_duration=if closing_color.is_some(){closing.closing_effect_duration.max(0.0)}else{0.0};
    let first_duration=segment_duration(&opening.segments);
    let last_duration=segment_duration(&closing.segments);
    let opening_extra=(opening_duration-first_duration).max(0.0);
    let closing_extra=(closing_duration-last_duration).max(0.0);
    let total_duration=opening_extra+joined_duration+closing_extra;
    let closing_start=(total_duration-closing_duration).max(0.0);
    let opening_audio_fade=opening_duration.min(first_duration);
    let has_background_music=background_music.is_some();
    let mut effect_video="[vjoined]".to_string();let mut effect_audio="[ajoined]".to_string();
    if let Some(color)=opening_color {if opening_duration>0.0005{
        if opening_extra>0.0005{filter_parts.push(format!("{}tpad=start_mode=clone:start_duration={:.6},fade=t=in:st=0:d={:.6}:color={}[vopen]",effect_video,opening_extra,opening_duration,color));filter_parts.push(format!("anullsrc=r=48000:cl=stereo:d={:.6},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aopensilence]",opening_extra));filter_parts.push(format!("[aopensilence]{}concat=n=2:v=0:a=1[aopenbase]",effect_audio));}else{filter_parts.push(format!("{}fade=t=in:st=0:d={:.6}:color={}[vopen]",effect_video,opening_duration,color));filter_parts.push(format!("{}anull[aopenbase]",effect_audio));}
        filter_parts.push(format!("[aopenbase]afade=t=in:st={:.6}:d={:.6}[aopen]",opening_extra,opening_audio_fade));effect_video="[vopen]".into();effect_audio="[aopen]".into();
    }}
    if let Some(color)=closing_color {if closing_duration>0.0005{
        if closing_extra>0.0005{filter_parts.push(format!("{}tpad=stop_mode=clone:stop_duration={:.6},fade=t=out:st={:.6}:d={:.6}:color={}[v]",effect_video,closing_extra,closing_start,closing_duration,color));filter_parts.push(format!("anullsrc=r=48000:cl=stereo:d={:.6},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aclosesilence]",closing_extra));filter_parts.push(format!("{}[aclosesilence]concat=n=2:v=0:a=1[aclosebase]",effect_audio));}else{filter_parts.push(format!("{}fade=t=out:st={:.6}:d={:.6}:color={}[v]",effect_video,closing_start,closing_duration,color));filter_parts.push(format!("{}anull[aclosebase]",effect_audio));}
        if has_background_music{filter_parts.push("[aclosebase]anull[a]".into());}else{filter_parts.push(format!("[aclosebase]afade=t=out:st={:.6}:d={:.6}[a]",closing_start,closing_duration));}effect_video="[v]".into();effect_audio="[a]".into();
    }}
    if effect_video!="[v]"{filter_parts.push(format!("{}null[v]",effect_video));}if effect_audio!="[a]"{filter_parts.push(format!("{}anull[a]",effect_audio));}
    args.extend(["-filter_complex".into(),filter_parts.join(";"),"-map".into(),"[v]".into(),"-map".into(),"[a]".into()]);
    args.extend(standard_video_encoding(base_text.clone()));
    let result = run_ffmpeg(&app, args).await;
    for path in &intermediates { let _ = fs::remove_file(path); }
    if let Err(error)=result {let message=format!("Joining rendered presentation items failed. {}",error);write_startup_log(&message);return Err(message);}
    let mut active_base=base_path.clone();
    if let Some(music)=background_music {
        window.emit("production-render-progress", "Applying continuous background music and automatic ducking.").map_err(|error| error.to_string())?;
        let mixed_path=safe_working_path(&project_id,"mp4","production-music")?;let mixed_text=mixed_path.to_string_lossy().into_owned();
        let ranges=music.duck_ranges.iter().map(|range|format!("between(t,{:.6},{:.6})",range.start+opening_extra,range.end+opening_extra)).collect::<Vec<_>>().join("+");
        let duck=if ranges.is_empty(){"1".to_string()}else{format!("if(gt({},0),{:.4},1)",ranges,music.duck_factor.clamp(0.0,1.0))};
        let music_prefix=if opening_duration>0.0005{format!("anullsrc=r=48000:cl=stereo:d={:.6},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[musicsilence];[musicsilence][musicbody]concat=n=2:v=0:a=1[musicdelayed];",opening_duration)}else{"[musicbody]anull[musicdelayed];".to_string()};
        let mixed_output=if closing_duration>0.0005{format!("[0:a:0][music]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]afade=t=out:st={:.6}:d={:.6}[a]",closing_start,closing_duration)}else{"[0:a:0][music]amix=inputs=2:duration=first:normalize=0[a]".to_string()};
        let music_duration=(total_duration-opening_duration).max(0.0);
        let filter=format!("[1:a:0]atrim=duration={:.6},asetpts=PTS-STARTPTS,volume={:.4}[musicbody];{}[musicdelayed]volume='{}'[music];{}",music_duration,music.volume.clamp(0.0,1.0),music_prefix,duck,mixed_output);
        let mut mix_args=vec!["-y".into(),"-i".into(),base_text.clone(),"-stream_loop".into(),"-1".into(),"-i".into(),music.source,"-filter_complex".into(),filter,"-map".into(),"0:v:0".into(),"-map".into(),"[a]".into()];
        mix_args.extend(standard_video_encoding(mixed_text));run_ffmpeg(&app,mix_args).await?;let _=fs::remove_file(&active_base);active_base=mixed_path;
    }
    let active_text=active_base.to_string_lossy().into_owned();
    if replacements.is_empty() { return Ok(active_text); }

    let mut replacement_paths = Vec::new();
    for (index, replacement) in replacements.iter().enumerate() {
        window.emit("production-render-progress", format!("Rendering track replacement {} of {}.", index + 1, replacements.len())).map_err(|error| error.to_string())?;
        let path = safe_working_path(&format!("{}-replacement-{}", project_id, index + 1), "mp4", "track")?;
        let item = ProductionItem { label:format!("Track replacement {}",index+1),source: replacement.source.clone(), segments: replacement.segments.clone(), media_kind: replacement.media_kind.clone(), track_target: replacement.track_target.clone(),audio_volume:1.0,transition_type:"none".into(),transition_duration:0.0,attached_audio_source:String::new(),opening_effect_type:"none".into(),opening_effect_duration:0.0,closing_effect_type:"none".into(),closing_effect_duration:0.0 };
        if let Err(error) = render_production_item(&app, &item, &path).await {
            let _ = fs::remove_file(&active_base);
            for previous in &replacement_paths { let _ = fs::remove_file(previous); }
            return Err(format!("Track replacement {} could not be rendered. {}", index + 1, error));
        }
        replacement_paths.push(path);
    }

    window.emit("production-render-progress", "Applying audio and video track replacements.").map_err(|error| error.to_string())?;
    let output_path = safe_working_path(&project_id, "mp4", "production")?;
    let output_text = output_path.to_string_lossy().into_owned();
    let mut compose_args = vec!["-y".into(), "-i".into(), active_text.clone()];
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
    let _ = fs::remove_file(&active_base);
    for path in &replacement_paths { let _ = fs::remove_file(path); }
    compose_result?;
    Ok(output_text)
}

fn item(app: &tauri::AppHandle, label: &str, id: &str) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::new(label).id(id).build(app)
}

fn accelerated_item(app: &tauri::AppHandle, label: &str, id: &str, accelerator: &str) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::new(label).id(id).accelerator(accelerator).build(app)
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
        .item(&item(app,"Copy Source Selection Ctrl+C","copyMedia")?).item(&item(app,"Paste Ctrl+V","pasteMedia")?)
        .item(&item(app,"Paste Insert Explicitly Ctrl+Shift+V","pasteInsert")?)
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
        .item(&item(app,"Primary Replacement Target Both Audio and Video B","targetBoth")?).item(&item(app,"Primary Replacement Target Video Only V","targetVideo")?).item(&item(app,"Primary Replacement Target Audio Only A","targetAudio")?).build()?;
    let navigate = SubmenuBuilder::new(app, "Navigate")
        .item(&item(app,"Media Editor Workspace","showMediaWorkspace")?).item(&item(app,"Presentation Workspace","showPresentationWorkspace")?).item(&item(app,"AudioStudio Pro Workspace","showAudioWorkspace")?)
        .item(&item(app,"Next Workspace Ctrl+Tab","nextWorkspace")?).item(&item(app,"Previous Workspace Ctrl+Shift+Tab","previousWorkspace")?).separator()
        .item(&accelerated_item(app,"Presentation Timeline Alt+P","focusPresentationTimeline","Alt+P")?).item(&accelerated_item(app,"Source Media Library Alt+S","focusPresentationSources","Alt+S")?).separator()
        .item(&item(app,"Previous Section Ctrl+Page Up","previousSection")?).item(&item(app,"Next Section Ctrl+Page Down","nextSection")?)
        .separator().item(&item(app,"Open Media List","focusProjectItems")?).item(&item(app,"Playhead","focusPlayhead")?).build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(app,"Testing Guide","showTestingGuide")?).item(&item(app,"Instructions and Keyboard Shortcuts F1","showShortcuts")?).item(&item(app,"Toggle Sound Cues","toggleSoundCues")?)
        .item(&item(app,"About Accessible Media Editor","showAbout")?).build()?;
    MenuBuilder::new(app).items(&[&file,&edit,&insert,&project,&playback,&navigate,&help]).build()
}

fn main() {
    write_startup_log("Build 0.11.34 executable started.");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            write_startup_log("Tauri setup entered.");
            let _ = app_folder("Projects");
            let _ = app_folder("Exports");
            if let Some(window)=app.get_webview_window("main") {
                write_startup_log("Main WebView window found.");
                window.set_menu(build_menu(app.handle())?)?;
                write_startup_log("Native menu installed.");
                window.show()?;
                window.set_focus()?;
                write_startup_log("Main window shown and focused independently of frontend session recovery.");
            } else {
                write_startup_log("Main WebView window was not found.");
            }
            app.on_menu_event(|app,event| {
                let action=event.id.as_ref();
                if action=="exitApp" { app.exit(0); return; }
                if let Some(window)=app.get_webview_window("main") { let _=window.emit("menu-action",action); }
            });
            write_startup_log("Tauri setup completed.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_title_slide_image,log_frontend_startup,frontend_ready,pick_media_files,open_project_dialog,open_project_path,save_project_dialog,read_recovery_session,write_recovery_session,read_media_library,write_media_library,write_project,export_edited_media,open_projects_folder,open_exports_folder,reveal_exported_file,set_window_title,normalize_media,render_working_edit,render_production])
        .run(tauri::generate_context!())
        .expect("error while running Accessible Media Editor");
}
