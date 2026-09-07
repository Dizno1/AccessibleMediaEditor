#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
struct OpenProjectResult { path: String, content: String }

#[tauri::command]
fn pick_media_files(window: tauri::WebviewWindow) -> Vec<String> {
    rfd::FileDialog::new()
        .set_parent(&window)
        .set_title("Import Media")
        .add_filter("Supported media", &["mp4","mkv","mov","avi","webm","m4v","mp3","wav","m4a","aac","flac","ogg","opus","png","jpg","jpeg","gif","webp","bmp","tif","tiff"])
        .pick_files()
        .unwrap_or_default()
        .into_iter().map(|path| path.to_string_lossy().into_owned()).collect()
}

#[tauri::command]
fn open_project_dialog(window: tauri::WebviewWindow) -> Result<Option<OpenProjectResult>, String> {
    let Some(path) = rfd::FileDialog::new().set_parent(&window).set_title("Open Accessible Media Editor Project").add_filter("Accessible Media Editor project", &["ameproject"]).pick_file() else { return Ok(None); };
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    Ok(Some(OpenProjectResult { path: path.to_string_lossy().into_owned(), content }))
}

#[tauri::command]
fn save_project_dialog(window: tauri::WebviewWindow, suggested_name: String, content: String) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new().set_parent(&window).set_title("Save Accessible Media Editor Project").set_file_name(&suggested_name).add_filter("Accessible Media Editor project", &["ameproject"]).save_file() else { return Ok(None); };
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn write_project(path: String, content: String) -> Result<String, String> {
    fs::write(&path, content).map_err(|error| error.to_string())?; Ok(path)
}

fn item(app: &tauri::AppHandle, label: &str, id: &str) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::new(label).id(id).build(app)
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&item(app,"New Project Ctrl+N","newProject")?).item(&item(app,"Open Project... Ctrl+O","openProject")?)
        .separator().item(&item(app,"Save Ctrl+S","saveProject")?).item(&item(app,"Save As... Ctrl+Shift+S","saveProjectAs")?)
        .separator().item(&item(app,"Import Media... Ctrl+I","importMedia")?).separator().item(&item(app,"Exit","exitApp")?).build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app,"Undo Ctrl+Z","undo")?).item(&item(app,"Redo Ctrl+Y","redo")?)
        .separator().item(&item(app,"Remove Selected Item Delete","removeItem")?).build()?;
    let insert = SubmenuBuilder::new(app, "Insert")
        .item(&item(app,"Media... Ctrl+I","importMedia")?).item(&item(app,"Text...","addText")?)
        .item(&item(app,"Crossfade Transition","addTransition")?).build()?;
    let project = SubmenuBuilder::new(app, "Project")
        .item(&item(app,"Item Properties Alt+Enter","properties")?).separator()
        .item(&item(app,"Move Earlier Ctrl+Up","moveEarlier")?).item(&item(app,"Move Later Ctrl+Down","moveLater")?).build()?;
    let playback = SubmenuBuilder::new(app, "Playback")
        .item(&item(app,"Preview from Selected Item Ctrl+P","preview")?).item(&item(app,"Stop Escape","stop")?).build()?;
    let navigate = SubmenuBuilder::new(app, "Navigate")
        .item(&item(app,"Project Items","focusProjectItems")?).item(&item(app,"Playhead","focusPlayhead")?).build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(app,"Keyboard Shortcuts","showShortcuts")?).item(&item(app,"Toggle Sound Cues","toggleSoundCues")?)
        .item(&item(app,"About Accessible Media Editor","showAbout")?).build()?;
    MenuBuilder::new(app).items(&[&file,&edit,&insert,&project,&playback,&navigate,&help]).build()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if let Some(window)=app.get_webview_window("main") { window.set_menu(build_menu(app.handle())?)?; }
            app.on_menu_event(|app,event| {
                let action=event.id.as_ref();
                if action=="exitApp" { app.exit(0); return; }
                if let Some(window)=app.get_webview_window("main") { let _=window.emit("menu-action",action); }
            }); Ok(())
        })
        .invoke_handler(tauri::generate_handler![pick_media_files,open_project_dialog,save_project_dialog,write_project])
        .run(tauri::generate_context!())
        .expect("error while running Accessible Media Editor");
}
