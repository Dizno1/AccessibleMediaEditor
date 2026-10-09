#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

mod native_media_picker;

#[derive(Serialize)]
struct OpenProjectResult { path: String, content: String }

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
fn open_projects_folder() -> Result<(), String> {
    let folder = app_folder("Projects").ok_or("The Projects folder could not be created.")?;
    std::process::Command::new("explorer").arg(folder).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| error.to_string())
}

fn item(app: &tauri::AppHandle, label: &str, id: &str) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::new(label).id(id).build(app)
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&item(app,"Open Media... Ctrl+O","importMedia")?)
        .separator().item(&item(app,"New Project Ctrl+N","newProject")?).item(&item(app,"Open Project... Ctrl+Shift+O","openProject")?)
        .item(&item(app,"Save Project Ctrl+S","saveProject")?).item(&item(app,"Save Project As... Ctrl+Shift+S","saveProjectAs")?)
        .item(&item(app,"Open Projects Folder","openProjectsFolder")?).separator().item(&item(app,"Exit","exitApp")?).build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app,"Undo Ctrl+Z","undo")?).item(&item(app,"Redo Ctrl+Y","redo")?)
        .separator().item(&item(app,"Split at Playhead Ctrl+K","split")?).item(&item(app,"Remove Selected Item Delete","removeItem")?).build()?;
    let insert = SubmenuBuilder::new(app, "Insert")
        .item(&item(app,"Media... Ctrl+O","importMedia")?).item(&item(app,"Text...","addText")?)
        .item(&item(app,"Crossfade Transition","addTransition")?).build()?;
    let project = SubmenuBuilder::new(app, "Project")
        .item(&item(app,"Item Properties Alt+Enter","properties")?).separator()
        .item(&item(app,"Go to Exact Time... Ctrl+G","goToTime")?).item(&item(app,"Set In Mark Left Bracket","setIn")?).item(&item(app,"Set Out Mark Right Bracket","setOut")?).separator()
        .item(&item(app,"Move Earlier Ctrl+Up","moveEarlier")?).item(&item(app,"Move Later Ctrl+Down","moveLater")?).build()?;
    let playback = SubmenuBuilder::new(app, "Playback")
        .item(&item(app,"Play or Pause X","playPause")?).item(&item(app,"Audition Around Playhead Space","audition")?).separator()
        .item(&item(app,"Scrub Back 1 Second U","scrubBack1")?).item(&item(app,"Scrub Forward 1 Second I","scrubForward1")?)
        .item(&item(app,"Scrub Back 100 Milliseconds Shift+U","scrubBack100ms")?).item(&item(app,"Scrub Forward 100 Milliseconds Shift+I","scrubForward100ms")?)
        .item(&item(app,"Scrub Back 10 Milliseconds Ctrl+Shift+U","scrubBack10ms")?).item(&item(app,"Scrub Forward 10 Milliseconds Ctrl+Shift+I","scrubForward10ms")?)
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
        .invoke_handler(tauri::generate_handler![pick_media_files,open_project_dialog,save_project_dialog,write_project,open_projects_folder,set_window_title])
        .run(tauri::generate_context!())
        .expect("error while running Accessible Media Editor");
}
