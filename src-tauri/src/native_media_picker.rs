use std::path::PathBuf;

// A generous buffer for the Explorer-style multi-select return value.
#[cfg(windows)]
const FILE_BUFFER_LEN: usize = 65536;

/// ---------------------------------------------------------------------
/// 0.1.8: what changed, and why, read this before the code below
/// ---------------------------------------------------------------------
///
/// 0.1.7 made Ctrl+O check the clipboard first and skip the dialog
/// entirely when it found a multi-file copy — real testing found this
/// produced no dialog, no files, and no announcement of any kind. That
/// behavior is removed in 0.1.8. Ctrl+O and the Open Audio button now
/// always call `pick_files_native()` and always show the native dialog,
/// full stop, no exceptions, no clipboard inspection before it. (The
/// most likely cause of 0.1.7's silent failure: a Rust panic inside the
/// clipboard-reading path, before the dialog was ever shown, would
/// abort that command invocation without ever resolving or rejecting the
/// frontend's `invoke()` promise — matching "nothing happened, no
/// announcement" exactly. Whether that specific theory is correct or
/// not, removing the bypass removes the failure mode entirely rather
/// than trying to patch around it.)
///
/// What 0.1.8 adds instead is a live interception *inside* the dialog:
/// when the user presses Ctrl+V in the File Name field, and the
/// clipboard holds a copied multi-file Explorer selection (CF_HDROP,
/// 2+ paths), that paste is intercepted and replaced with the complete
/// list, expressed as a quoted, space-separated multi-name string —
/// `"C:\path\a.mp3" "C:\path\b.wav"` — which is GetOpenFileNameW's own
/// long-documented syntax for typing more than one filename directly
/// into that field. The user stays in the dialog and activates Open
/// normally; the existing, already-unit-tested
/// `parse_multi_select_buffer` (unchanged since 0.1.6) then reads the
/// result exactly as it would for any other multi-selection. If nothing
/// relevant is on the clipboard, Ctrl+V behaves completely normally
/// (default single-item paste).
///
/// ### How this works, mechanically
///
/// 1. `pick_files_native()` sets `OFN_ENABLEHOOK` and `lpfnHook` to
///    `open_dialog_hook_proc`, an Explorer-style OFNHookProc.
/// 2. That hook does nothing for every message except one: on the
///    `CDN_INITDONE` notification (sent once, when the dialog has
///    finished laying itself out), it locates the File Name
///    ComboBoxEx32 control — control ID `0x47C` (`cmb13` in Microsoft's
///    own dialog-template naming, confirmed independently against a
///    Microsoft MVP's description of this exact control hierarchy) —
///    tries several plausible parent-window candidates defensively
///    (the hook's own `hdlg` parameter, its `GetParent`, and the
///    notification's `hwndFrom`, since which one is "correct" for this
///    specific hook type could not be verified here), and if found,
///    installs a window subclass (`SetWindowSubclass`) on it.
/// 3. The subclass procedure (`paste_subclass_proc`) does nothing for
///    every message except `WM_PASTE`. On that one message: it reads the
///    clipboard end to end (`read_clipboard_diagnosed`, recording every
///    stage — see "Clipboard-boundary diagnostics" below), and if 2+
///    files are found there, builds the quoted multi-name
///    string and calls `SetWindowTextW` on the control directly instead
///    of letting the default paste happen. Otherwise, it calls
///    `DefSubclassProc` — ordinary default paste behavior, unchanged.
///
/// Every one of those steps is written to fail *silently and safely*:
/// if the control can't be found, if subclassing fails, if the
/// clipboard read fails, the code always falls through to leaving the
/// dialog exactly as it would behave with no hook installed at all. The
/// one thing this code must never do is turn a failure into a hang or a
/// crash of the dialog itself — every branch that isn't the one
/// deliberately-handled case returns control to Windows' own default
/// processing immediately.
///
/// ### What is and is not verified — read this before trusting this build
///
/// This is the deepest, least-verifiable Windows-specific code shipped
/// in this project so far, and that should be stated plainly rather than
/// smoothed over. Confirmed directly against Microsoft's own generated
/// Rust API documentation: the `LPOFNHOOKPROC` function signature, the
/// `OFNOTIFY`/`NMHDR` structure shapes, the `CDN_INITDONE` notification
/// code, and the `SetWindowSubclass`/`DefSubclassProc` function
/// signatures. Corroborated from an independent, real-world source (a
/// Microsoft MVP's public description of the exact control nesting):
/// the `0x47C` control ID and its three-level
/// ComboBoxEx32→ComboBox→Edit structure. **Not verified, and not
/// verifiable in this environment:** whether `GetOpenFileNameW`'s own
/// multi-name text parser accepts a *pasted* quoted multi-path string
/// identically to how it accepts list-view-driven multi-selection —
/// this is the single largest remaining assumption, since it's the step
/// that actually determines whether this feature does anything useful
/// even if every mechanical piece above works exactly as designed. This
/// environment cannot compile or run any Windows-specific code at all,
/// confirmed directly across every build since 0.1.4 — that has not
/// changed for 0.1.8.

/// Everything Open Audio Diagnostics needs to distinguish exactly where,
/// between "Ctrl+V pressed" and "paths obtained," the clipboard-reading
/// path stops — the specific distinctions requested after 0.1.8's first
/// real-world test: the subclass not receiving WM_PASTE at all is a
/// different finding than OpenClipboard failing, which is different from
/// CF_HDROP genuinely not being on the clipboard, which is different from
/// CF_HDROP being available but GetClipboardData failing, which is
/// different from GetClipboardData succeeding but DragQueryFileW
/// returning nothing — each of those was previously collapsed into a
/// single "no."
#[cfg(windows)]
#[derive(Default, Clone)]
struct ClipboardReadDiagnostics {
    open_clipboard_succeeded: bool,
    open_clipboard_error: u32,
    cf_hdrop_available: bool,
    available_formats: Vec<u32>,
    get_clipboard_data_succeeded: bool,
    drag_query_file_count: u32,
    paths: Vec<PathBuf>,
}

/// Reads the Windows clipboard end to end, recording exactly what
/// happened at every stage rather than only the final yes/no this
/// function used to return. Every one of the stages below is captured in
/// the result regardless of whether earlier stages succeeded, wherever
/// that's meaningful — e.g. `available_formats` is populated even when
/// `CF_HDROP` isn't among them, specifically to answer "what did Explorer
/// actually put there" rather than just "was the one format we expected
/// present."
#[cfg(windows)]
fn read_clipboard_diagnosed() -> ClipboardReadDiagnostics {
    use windows::Win32::Foundation::{GetLastError, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EnumClipboardFormats, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard,
    };
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::DragQueryFileW;

    let mut diag = ClipboardReadDiagnostics::default();

    unsafe {
        // Checked before OpenClipboard, matching how IsClipboardFormatAvailable
        // is documented to work — it does not itself require the clipboard
        // to be open first.
        diag.cf_hdrop_available = IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_ok();

        match OpenClipboard(HWND::default()) {
            Ok(()) => {
                diag.open_clipboard_succeeded = true;
            }
            Err(_) => {
                diag.open_clipboard_error = GetLastError().0;
                // Never call CloseClipboard after a failed OpenClipboard —
                // there is nothing to close, and doing so anyway is
                // documented as incorrect API usage.
                return diag;
            }
        }

        // Enumerate every format actually present, independent of
        // CF_HDROP specifically — this is what actually answers "what did
        // Explorer really put on the clipboard," rather than only
        // confirming or denying the one format this app looks for.
        // Bounded defensively: EnumClipboardFormats is documented to
        // terminate at 0, and the clipboard has a small, finite number of
        // formats in ordinary use, but this cap ensures that even a
        // pathological or unexpected return sequence can never turn this
        // loop into an unbounded one — added specifically after a real
        // test session where the whole native dialog lifecycle appeared
        // to stop reporting anything at all, to remove any possibility
        // this loop contributes to that, however unlikely.
        let mut fmt = 0u32;
        for _ in 0..256 {
            let next = EnumClipboardFormats(fmt);
            if next == 0 {
                break;
            }
            diag.available_formats.push(next);
            fmt = next;
        }

        if diag.cf_hdrop_available {
            match GetClipboardData(CF_HDROP.0 as u32) {
                Ok(handle) => {
                    diag.get_clipboard_data_succeeded = true;
                    let hdrop = windows::Win32::UI::Shell::HDROP(handle.0);

                    let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
                    diag.drag_query_file_count = count;

                    for i in 0..count {
                        let needed_len = DragQueryFileW(hdrop, i, None);
                        if needed_len == 0 {
                            continue;
                        }
                        let mut buffer = vec![0u16; (needed_len + 1) as usize];
                        let written = DragQueryFileW(hdrop, i, Some(&mut buffer));
                        if written == 0 {
                            continue;
                        }
                        buffer.truncate(written as usize);
                        diag.paths.push(PathBuf::from(String::from_utf16_lossy(&buffer)));
                    }
                }
                Err(_) => {
                    diag.get_clipboard_data_succeeded = false;
                }
            }
        }

        // Always reached from here on, on every path that successfully
        // opened the clipboard above — per requirement #9.
        let _ = CloseClipboard();
    }

    diag
}

#[cfg(not(windows))]
#[derive(Default, Clone)]
struct ClipboardReadDiagnostics {
    open_clipboard_succeeded: bool,
    open_clipboard_error: u32,
    cf_hdrop_available: bool,
    available_formats: Vec<u32>,
    get_clipboard_data_succeeded: bool,
    drag_query_file_count: u32,
    paths: Vec<PathBuf>,
}

#[cfg(not(windows))]
fn read_clipboard_diagnosed() -> ClipboardReadDiagnostics {
    ClipboardReadDiagnostics::default()
}

// Thread-local, not global, because GetOpenFileNameW blocks the calling
// thread until the dialog closes, and its hook/subclass callbacks always
// run on that same thread (window procedures never run cross-thread) —
// so a plain thread-local cell is enough to pass diagnostics out of
// callbacks that can't otherwise return data to pick_files_native().
#[cfg(windows)]
thread_local! {
    static PASTE_DIAGNOSTICS: std::cell::RefCell<PasteDiagnostics> =
        std::cell::RefCell::new(PasteDiagnostics::default());
}

#[cfg(windows)]
#[derive(Default, Clone)]
struct PasteDiagnostics {
    outer_combo_located: bool,
    inner_edit_located: bool,
    wm_paste_received: bool,
    open_clipboard_succeeded: bool,
    open_clipboard_error: u32,
    cf_hdrop_available: bool,
    available_formats: Vec<u32>,
    get_clipboard_data_succeeded: bool,
    drag_query_file_count: u32,
    hdrop_detected: bool,
    hdrop_file_count: usize,
    hdrop_file_names: Vec<String>,
    quoted_text_written: String,
}

/// The File Name ComboBoxEx32 control's ID in an Explorer-style
/// GetOpenFileName(W) dialog. Not officially documented by Microsoft,
/// but consistently reported (including by a Microsoft MVP, describing
/// the exact ComboBoxEx32 → ComboBox → Edit nesting used here) as
/// `0x47C`, matching the classic dialog-template name `cmb13`.
#[cfg(windows)]
const FILENAME_COMBO_ID: i32 = 0x47C;

#[cfg(windows)]
const SUBCLASS_ID: usize = 0xAA51;

/// Builds the quoted, space-separated multi-name string
/// GetOpenFileNameW's own File Name field accepts for typing (or, as
/// used here, pasting) more than one filename at once:
/// `"C:\path\a.mp3" "C:\path\b.wav"`.
#[cfg(windows)]
fn build_quoted_multi_name(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| format!("\"{}\"", p.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Raw FFI declarations for the three Comctl32 window-subclassing helper
/// functions used by the hook below. Declared here directly, linked
/// against `comctl32.dll`, rather than imported from the `windows`
/// crate — after `windows::Win32::UI::Controls::SetWindowSubclass`
/// itself failed to resolve at all in the real Windows build (not a
/// type mismatch this time, an unresolved symbol), the most likely
/// explanation is that these particular Comctl32 helper functions simply
/// aren't present in this crate/feature combination's generated
/// bindings at all — Microsoft's own win32metadata project, which
/// `windows-rs` generates its bindings from, doesn't cover every Win32
/// API, and these window-subclassing helpers are a comparatively obscure
/// corner of it. Rather than guess at a different module path or a
/// different crate version (which would risk the exact "dependency
/// roulette" this correction explicitly asked to avoid), declaring the
/// three functions directly removes any dependency on `windows-rs`
/// having generated bindings for them, while their C signatures — which
/// haven't changed since Windows XP — are well-documented and stable:
/// `BOOL SetWindowSubclass(HWND, SUBCLASSPROC, UINT_PTR, DWORD_PTR)`,
/// `BOOL RemoveWindowSubclass(HWND, SUBCLASSPROC, UINT_PTR)`,
/// `LRESULT DefSubclassProc(HWND, UINT, WPARAM, LPARAM)`
/// (commctrl.h). The `HWND`/`WPARAM`/`LPARAM`/`LRESULT` types used in
/// these declarations are still the ordinary `windows` crate ones —
/// each is a `#[repr(transparent)]` wrapper with the exact same ABI
/// layout as the raw type it wraps, so using them here is exactly as
/// correct as declaring the parameters as raw pointers/integers
/// directly, with the benefit of staying consistent with every other
/// signature in this file. Only the three *function* bindings
/// themselves — the specific thing that failed to resolve — are
/// hand-declared instead of crate-provided.
#[cfg(windows)]
type SubclassProc = unsafe extern "system" fn(
    windows::Win32::Foundation::HWND,
    u32,
    windows::Win32::Foundation::WPARAM,
    windows::Win32::Foundation::LPARAM,
    usize,
    usize,
) -> windows::Win32::Foundation::LRESULT;

#[cfg(windows)]
#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(
        hwnd: windows::Win32::Foundation::HWND,
        subclass_proc: SubclassProc,
        subclass_id: usize,
        ref_data: usize,
    ) -> i32; // BOOL

    #[allow(dead_code)] // kept for completeness/symmetry; not currently called — see the module doc comment on subclass lifetime
    fn RemoveWindowSubclass(
        hwnd: windows::Win32::Foundation::HWND,
        subclass_proc: SubclassProc,
        subclass_id: usize,
    ) -> i32; // BOOL

    fn DefSubclassProc(
        hwnd: windows::Win32::Foundation::HWND,
        msg: u32,
        wparam: windows::Win32::Foundation::WPARAM,
        lparam: windows::Win32::Foundation::LPARAM,
    ) -> windows::Win32::Foundation::LRESULT;
}

/// The real, fixed C memory layout of `RECT` (windef.h):
/// `typedef struct tagRECT { LONG left; LONG top; LONG right; LONG bottom; } RECT;`
/// — only needed here as a correctly-sized/aligned field inside
/// `RawComboBoxInfo` below; nothing in this file ever reads its values.
#[cfg(windows)]
#[repr(C)]
struct RawRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// The real, fixed C memory layout of `COMBOBOXINFO` (winuser.h):
/// `typedef struct tagCOMBOBOXINFO { DWORD cbSize; RECT rcItem; RECT rcButton;
/// DWORD stateButton; HWND hwndCombo; HWND hwndItem; HWND hwndList; } COMBOBOXINFO;`
/// — `hwnd_item` (`hwndItem` in the real struct) is the one field this file
/// actually needs: "A handle to the edit box," per Microsoft's own
/// documentation of this struct. Defined locally, and paired with a raw
/// `GetComboBoxInfo` FFI declaration below, for the same reason as
/// `RawNmhdr`/`CDN_INITDONE` earlier in this file: `COMBOBOXINFO` and
/// `GetComboBoxInfo` are documented as living in
/// `windows::Win32::UI::Controls` — the exact module that failed to
/// export `SetWindowSubclass` in this same crate/feature combination
/// despite equally solid documentation. Rather than trust that module a
/// second time, this sidesteps the question entirely.
#[cfg(windows)]
#[repr(C)]
struct RawComboBoxInfo {
    cb_size: u32,
    rc_item: RawRect,
    rc_button: RawRect,
    state_button: u32,
    hwnd_combo: windows::Win32::Foundation::HWND,
    hwnd_item: windows::Win32::Foundation::HWND,
    hwnd_list: windows::Win32::Foundation::HWND,
}

/// Raw FFI declaration for `GetComboBoxInfo`, linked against
/// `user32.dll` (per Microsoft's own documented DLL for this function —
/// a core, always-present system library, more fundamental even than
/// `comctl32.dll`). C signature, unchanged since Windows Vista:
/// `BOOL GetComboBoxInfo(HWND hwndCombo, PCOMBOBOXINFO pcbi)`.
#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetComboBoxInfo(
        hwnd_combo: windows::Win32::Foundation::HWND,
        pcbi: *mut RawComboBoxInfo,
    ) -> i32; // BOOL

    fn FindWindowExW(
        hwnd_parent: windows::Win32::Foundation::HWND,
        hwnd_child_after: windows::Win32::Foundation::HWND,
        class_name: windows::core::PCWSTR,
        window_name: windows::core::PCWSTR,
    ) -> windows::Win32::Foundation::HWND;
}

/// Resolve the actual editable HWND inside the File Name ComboBoxEx32.
/// The common dialog nests this as ComboBoxEx32 -> ComboBox -> Edit.
/// 0.2.1 called GetComboBoxInfo on the outer ComboBoxEx32 itself; that API
/// is for a ComboBox and can therefore fail before ever reaching hwndItem.
/// This resolver first walks the documented/common-control child hierarchy
/// directly, then uses GetComboBoxInfo on the inner ComboBox as a fallback.
#[cfg(windows)]
unsafe fn find_filename_edit(
    combo_ex: windows::Win32::Foundation::HWND,
) -> windows::Win32::Foundation::HWND {
    use windows::Win32::Foundation::HWND;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let combo_class = wide("ComboBox");
    let edit_class = wide("Edit");
    let null_name = windows::core::PCWSTR::null();

    let inner_combo = FindWindowExW(
        combo_ex,
        HWND::default(),
        windows::core::PCWSTR(combo_class.as_ptr()),
        null_name,
    );

    if inner_combo != HWND::default() {
        let edit = FindWindowExW(
            inner_combo,
            HWND::default(),
            windows::core::PCWSTR(edit_class.as_ptr()),
            null_name,
        );
        if edit != HWND::default() {
            return edit;
        }

        let mut info = RawComboBoxInfo {
            cb_size: std::mem::size_of::<RawComboBoxInfo>() as u32,
            rc_item: RawRect { left: 0, top: 0, right: 0, bottom: 0 },
            rc_button: RawRect { left: 0, top: 0, right: 0, bottom: 0 },
            state_button: 0,
            hwnd_combo: HWND::default(),
            hwnd_item: HWND::default(),
            hwnd_list: HWND::default(),
        };
        if GetComboBoxInfo(inner_combo, &mut info) != 0 && info.hwnd_item != HWND::default() {
            return info.hwnd_item;
        }
    }

    // Defensive extra case for dialog variants where Edit is directly
    // parented by the ComboBoxEx32.
    FindWindowExW(
        combo_ex,
        HWND::default(),
        windows::core::PCWSTR(edit_class.as_ptr()),
        null_name,
    )
}

/// Window subclass procedure installed on the File Name control. Handles
/// exactly one message, WM_PASTE; every other message goes straight to
/// `DefSubclassProc`, unmodified default behavior.
#[cfg(windows)]
unsafe extern "system" fn paste_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::WM_PASTE;

    if msg == WM_PASTE {
        let cd = read_clipboard_diagnosed();

        PASTE_DIAGNOSTICS.with(|d| {
            let mut d = d.borrow_mut();
            d.wm_paste_received = true;
            d.open_clipboard_succeeded = cd.open_clipboard_succeeded;
            d.open_clipboard_error = cd.open_clipboard_error;
            d.cf_hdrop_available = cd.cf_hdrop_available;
            d.available_formats = cd.available_formats.clone();
            d.get_clipboard_data_succeeded = cd.get_clipboard_data_succeeded;
            d.drag_query_file_count = cd.drag_query_file_count;
            d.hdrop_detected = cd.paths.len() >= 2;
            d.hdrop_file_count = cd.paths.len();
            d.hdrop_file_names = cd
                .paths
                .iter()
                .map(|p| {
                    p.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| p.to_string_lossy().to_string())
                })
                .collect();
        });

        if cd.paths.len() >= 2 {
            let text = build_quoted_multi_name(&cd.paths);
            PASTE_DIAGNOSTICS.with(|d| d.borrow_mut().quoted_text_written = text.clone());

            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            use windows::Win32::UI::WindowsAndMessaging::SetWindowTextW;
            let _ = SetWindowTextW(hwnd, windows::core::PCWSTR(wide.as_ptr()));

            // Handled — do not also run default paste behavior,
            // which would otherwise insert the clipboard's own
            // (single-name-at-best) text representation afterward.
            return windows::Win32::Foundation::LRESULT(0);
        }
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// The real, fixed C memory layout of `NMHDR` (winuser.h/commctrl.h):
/// `typedef struct tagNMHDR { HWND hwndFrom; UINT_PTR idFrom; UINT code; } NMHDR;`
/// — the header every `WM_NOTIFY` message (including the `OFNOTIFYW` the
/// dialog hook receives, which starts with this exact struct as its
/// first field) begins with, unchanged since Windows 3.1.
///
/// Defined locally, rather than imported from the `windows` crate,
/// specifically because that import path (`Win32::UI::Controls::Dialogs`)
/// turned out not to resolve cleanly for this notification's types in
/// the real Windows build — the previous version of this file imported
/// `OFNOTIFYW` and `CDN_INITDONE` from there, and the real compiler
/// reported an unresolved `CDN_INITDONE` and a cascading type error on
/// the resulting `notify` value. Since only two fields are ever needed
/// here (`code`, to identify which notification this is, and
/// `hwndFrom`, one of the candidate parent windows used below), reading
/// them via a hand-written, `#[repr(C)]` struct matching the documented
/// ABI exactly removes any dependency on whichever `windows` crate
/// module does or doesn't export the full notification types — Windows
/// itself writes this memory layout; nothing here depends on how any
/// particular Rust binding chooses to model it.
#[cfg(windows)]
#[repr(C)]
struct RawNmhdr {
    hwnd_from: windows::Win32::Foundation::HWND,
    id_from: usize,
    code: u32,
}

/// CDN_INITDONE's real value, per commdlg.h:
/// `#define CDN_FIRST (0U-601U)` and `#define CDN_INITDONE (CDN_FIRST - 0x0000)`
/// — i.e. `0u32.wrapping_sub(601)`. Hardcoded for the same reason as
/// `RawNmhdr` above: this is a fixed, decades-stable Win32 ABI constant,
/// not something that needs to come from whichever crate module happens
/// to export it (or, as found here, doesn't).
#[cfg(windows)]
const CDN_INITDONE: u32 = 0u32.wrapping_sub(601);

/// OFNHookProc installed on the Open dialog. Handles exactly one
/// notification, CDN_INITDONE (sent once, after the dialog has finished
/// laying itself out); every other message returns 0 immediately,
/// meaning "not handled, use default processing" — the standard,
/// conservative return for an Explorer-style OFN hook.
#[cfg(windows)]
unsafe extern "system" fn open_dialog_hook_proc(
    hdlg: windows::Win32::Foundation::HWND,
    msg: u32,
    _wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> usize {
    use windows::Win32::UI::WindowsAndMessaging::{GetDlgItem, GetParent, WM_NOTIFY};

    if msg != WM_NOTIFY {
        return 0;
    }

    let notify = &*(lparam.0 as *const RawNmhdr);
    if notify.code != CDN_INITDONE {
        return 0;
    }

    // Try every plausible "real dialog window" candidate defensively —
    // which one is correct for this specific hook type was not possible
    // to confirm in this environment. GetDlgItem simply returns a null
    // handle for a wrong candidate; trying more than one costs nothing
    // and only improves the odds of finding the real control.
    let candidates = [hdlg, GetParent(hdlg).unwrap_or_default(), notify.hwnd_from];

    for parent in candidates {
        if parent == windows::Win32::Foundation::HWND::default() {
            continue;
        }
        // windows 0.58 resolves this parameter through the windows_core
        // Param<HWND> trait, which takes the HWND value directly rather
        // than an Option-wrapped one (unlike GetParent's return type,
        // which genuinely is optional and stays Option-handled above via
        // unwrap_or_default()) — GetDlgItem's own "control not found"
        // case is expressed through its Result, not through Option on
        // the input. An earlier version of this line, `Some(parent)`,
        // was exactly that mix-up, caught by the real Windows compiler.
        if let Ok(combo) = GetDlgItem(parent, FILENAME_COMBO_ID) {
            if combo != windows::Win32::Foundation::HWND::default() {
                PASTE_DIAGNOSTICS.with(|d| d.borrow_mut().outer_combo_located = true);

                // GetDlgItem(cmb13) gives the outer ComboBoxEx32. The actual
                // keyboard-edit target is normally nested one level deeper:
                // ComboBoxEx32 -> ComboBox -> Edit. 0.2.1 mistakenly passed
                // the outer ComboBoxEx32 to GetComboBoxInfo, so the edit HWND
                // could remain undiscovered and WM_PASTE would still bypass us.
                let edit = find_filename_edit(combo);
                let target = if edit != windows::Win32::Foundation::HWND::default() {
                    PASTE_DIAGNOSTICS.with(|d| d.borrow_mut().inner_edit_located = true);
                    edit
                } else {
                    // Preserve normal dialog behavior even if Windows presents
                    // an unexpected control hierarchy.
                    combo
                };

                let _ = SetWindowSubclass(target, paste_subclass_proc, SUBCLASS_ID, 0);
                break;
            }
        }
    }

    0
}

/// Shows Windows' classic Explorer-style multi-select "Open" dialog —
/// `GetOpenFileNameW` with `OFN_EXPLORER | OFN_ALLOWMULTISELECT` — always,
/// every time Open Audio is activated. See the module-level doc comment
/// above for what the hook installed here does and why.
///
/// `hwndOwner` is set to the app's real main window handle, not `HWND::default()`
/// (NULL) as in every previous version of this function. Real testing
/// found the dialog behaving as something less than a genuine modal —
/// specifically, Shift+Tab immediately left it and returned focus to the
/// main app window, rather than cycling within the dialog the way a
/// properly modal Windows dialog does. `GetOpenFileNameW`'s own
/// documentation is explicit that `hwndOwner` should be "a handle to the
/// window that owns the dialog box" — with no owner, Windows has no
/// window to establish the actual modal ownership/z-order relationship
/// against, which is a plausible, direct explanation for exactly that
/// symptom. The real HWND is obtained from Tauri's own main window
/// (`app.get_webview_window("main")`, the label this app's only window
/// is configured with in `tauri.conf.json`) via its own `hwnd()` method —
/// a pattern confirmed directly from Tauri's own maintainers discussing
/// this exact API. The returned handle's raw pointer value is
/// reconstructed into this file's own `windows::Win32::Foundation::HWND`
/// (via its single `.0` field, the same pattern already used elsewhere in
/// this file for other handle types) rather than relied on as the exact
/// same type, since Tauri may depend on its own, possibly different,
/// version of the `windows` crate internally.
#[cfg(windows)]
fn pick_files_native(app: &tauri::AppHandle) -> Result<(Vec<PathBuf>, PasteDiagnostics), String> {
    use tauri::Manager;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, OFN_ALLOWMULTISELECT, OFN_ENABLEHOOK,
        OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };
    // Required for `.window_handle()` below — confirmed as the real,
    // correct trait via Tauri's own docs.rs (see the doc comment at that
    // call site), not the same speculative attempt as before.
    use raw_window_handle::HasWindowHandle;

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    // 0.2.7.2: reverted to the exact known-good 0.2.6 implementation below.
    // Both 0.2.7's original `.hwnd()` call (build #27) and the
    // `raw_window_handle`-based replacement attempted for build #28
    // failed on real Windows CI. A direct, byte-for-byte diff against
    // the actual 0.2.6 source (not inferred) confirms this function, its
    // imports, and Cargo.toml's `tauri` dependency line are completely
    // unchanged between 0.2.6 and 0.2.7 — the only differences anywhere
    // near this code are the two failed rewrite attempts themselves.
    // Restoring the known-good call is therefore the correct baseline —
    // but see docs/Pro Roadmap.md, 0.2.7.2, for why this alone is
    // unlikely to be sufficient: `Cargo.toml` pins `tauri = { version =
    // "2" }`, an unpinned major-version spec, and no `Cargo.lock` has
    // ever existed in this repository — true in 0.2.6 as well as 0.2.7.
    // A fresh build of 0.2.6's exact source, run today, would very
    // plausibly resolve the same current Tauri/wry release and hit the
    // same error, since nothing pins which version gets resolved.
    // 0.2.7.3: restored to window_handle()/HasWindowHandle — confirmed,
    // not guessed, this time. Tauri's own docs.rs page for WebviewWindow
    // in tauri 2.0.0 (the very first stable Tauri 2.x release, October
    // 2024) lists no `hwnd()` method anywhere in its full method list,
    // and directly confirms:
    //   impl<R: Runtime> HasWindowHandle for WebviewWindow<R>
    //       fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError>
    // This has been WebviewWindow's real, only window-handle-access API
    // since Tauri 2.0.0 — not something that changed in some newer
    // release. A `cargo generate-lockfile` in this environment confirmed
    // separately that even pinning `tauri` to its oldest 2.0.x release
    // still resolves `wry` to a version past the `raw-window-handle 0.6`
    // transition, meaning a version pin alone — without this exact code
    // — could not have restored `.hwnd()` even in principle, since
    // `.hwnd()` does not appear to have ever been valid on
    // `tauri::webview::WebviewWindow` in any Tauri 2.x release. See
    // docs/Pro Roadmap.md, 0.2.7.3, for the full evidence trail,
    // including why 0.2.6's `.hwnd()` call compiling historically
    // remains a genuine, named open question rather than something this
    // build claims to have fully explained.
    // 0.2.7.4: real bug found and fixed. Build #30 (real Windows CI)
    // failed with `error[E0515]: cannot return value referencing
    // function parameter 'w'` — confirmed by isolating this exact chain
    // and compiling it against the real `raw-window-handle` crate (not a
    // stub) in this environment: `.and_then(|w| w.window_handle().ok())`
    // is genuinely broken, because `window_handle()` borrows from `w`
    // (a `WindowHandle<'_>` tied to `&self`), but `w` is a closure
    // parameter that does not live past the closure call — the
    // borrowed `WindowHandle` cannot outlive the value it borrows from.
    // 0.2.7.1's isolated verification tested this crate's types with
    // separate, non-chained `let` bindings, which never exposed this
    // exact lifetime trap; the real chained code was never compile-
    // tested until now. Fixed by moving the entire extraction — the
    // `window_handle()` call AND the match that pulls out the owned
    // HWND value — inside one closure, so it runs while `w` is still
    // alive and returns only owned data (`Option<HWND>`), never
    // anything borrowed from `w` itself. Confirmed this exact corrected
    // pattern compiles cleanly against the real `raw-window-handle`
    // crate before applying it here.
    let owner_hwnd: HWND = app
        .get_webview_window("main")
        .and_then(|w| {
            w.window_handle().ok().and_then(|handle| match handle.as_raw() {
                raw_window_handle::RawWindowHandle::Win32(h) => {
                    Some(HWND(h.hwnd.get() as *mut std::ffi::c_void))
                }
                _ => None,
            })
        })
        .unwrap_or_default();

    PASTE_DIAGNOSTICS.with(|d| *d.borrow_mut() = PasteDiagnostics::default());

    let filter = to_wide("Supported media\0*.mp4;*.mkv;*.mov;*.avi;*.webm;*.m4v;*.3gp;*.3g2;*.mts;*.m2ts;*.mpeg;*.mpg;*.ts;*.wmv;*.ogv;*.hevc;*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.opus;*.wma;*.aif;*.aiff;*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.tif;*.tiff;*.heic;*.heif\0All Files\0*.*\0\0");
    let title = to_wide("Import Media");
    let mut file_buffer: Vec<u16> = vec![0u16; FILE_BUFFER_LEN];

    let mut ofn = OPENFILENAMEW::default();
    ofn.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    ofn.hwndOwner = owner_hwnd;
    ofn.lpstrFilter = windows::core::PCWSTR(filter.as_ptr());
    ofn.lpstrFile = PWSTR(file_buffer.as_mut_ptr());
    ofn.nMaxFile = file_buffer.len() as u32;
    ofn.lpstrTitle = windows::core::PCWSTR(title.as_ptr());
    ofn.Flags = OFN_EXPLORER
        | OFN_ALLOWMULTISELECT
        | OFN_FILEMUSTEXIST
        | OFN_PATHMUSTEXIST
        | OFN_HIDEREADONLY
        | OFN_ENABLEHOOK;
    ofn.lpfnHook = Some(open_dialog_hook_proc);

    let succeeded = unsafe { GetOpenFileNameW(&mut ofn) };

    let diagnostics = PASTE_DIAGNOSTICS.with(|d| d.borrow().clone());

    if !succeeded.as_bool() {
        let error_code = unsafe { CommDlgExtendedError() };
        if error_code.0 == 0 {
            return Ok((Vec::new(), diagnostics));
        }
        return Err(format!(
            "GetOpenFileNameW failed (CommDlgExtendedError code {}).",
            error_code.0
        ));
    }

    Ok((parse_multi_select_buffer(&file_buffer), diagnostics))
}

/// Parses the Explorer-style multi-select return buffer into a list of
/// complete file paths. Unit-tested (real rustc, not simulated) since
/// 0.1.6 — see docs/Pro Roadmap.md — and unchanged since.
#[cfg(windows)]
fn parse_multi_select_buffer(buffer: &[u16]) -> Vec<PathBuf> {
    let mut strings: Vec<String> = Vec::new();
    let mut start = 0usize;
    for i in 0..buffer.len() {
        if buffer[i] == 0 {
            if i == start {
                break;
            }
            strings.push(String::from_utf16_lossy(&buffer[start..i]));
            start = i + 1;
        }
    }

    match strings.len() {
        0 => Vec::new(),
        1 => vec![PathBuf::from(&strings[0])],
        _ => {
            let dir = PathBuf::from(&strings[0]);
            strings[1..].iter().map(|name| dir.join(name)).collect()
        }
    }
}



#[cfg(windows)]
pub fn pick_media_files(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let (paths, _) = pick_files_native(app)?;
    Ok(paths.into_iter().map(|path| path.to_string_lossy().into_owned()).collect())
}

#[cfg(not(windows))]
pub fn pick_media_files(_app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    Err("The Windows media picker is available only in the Windows application.".to_string())
}
