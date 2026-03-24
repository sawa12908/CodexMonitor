use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{Local, SecondsFormat};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const DIAGNOSTIC_LOG_FILE_NAME: &str = "diagnostic.log";
const DIAGNOSTIC_LOG_ROTATED_FILE_NAME: &str = "diagnostic.log.1";
const DIAGNOSTIC_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn diagnostic_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;
    Ok(data_dir.join(DIAGNOSTIC_LOG_FILE_NAME))
}

fn rotate_log_if_needed(path: &Path) -> Result<(), String> {
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(format!("Failed to read diagnostic log metadata: {err}")),
    };

    if metadata.len() < DIAGNOSTIC_LOG_MAX_BYTES {
        return Ok(());
    }

    let rotated_path = path.with_file_name(DIAGNOSTIC_LOG_ROTATED_FILE_NAME);
    if rotated_path.exists() {
        fs::remove_file(&rotated_path)
            .map_err(|err| format!("Failed to remove rotated diagnostic log: {err}"))?;
    }
    fs::rename(path, rotated_path)
        .map_err(|err| format!("Failed to rotate diagnostic log: {err}"))?;
    Ok(())
}

pub(crate) fn append_app_diagnostic(
    app: &AppHandle,
    source: &str,
    label: &str,
    payload: Value,
) -> Result<(), String> {
    let path = diagnostic_log_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create diagnostic log directory: {err}"))?;
    }
    rotate_log_if_needed(&path)?;

    let entry = json!({
        "timestamp": Local::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        "pid": std::process::id(),
        "source": source,
        "label": label,
        "payload": payload,
    });

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|err| format!("Failed to open diagnostic log: {err}"))?;
    serde_json::to_writer(&mut file, &entry)
        .map_err(|err| format!("Failed to encode diagnostic log entry: {err}"))?;
    file.write_all(b"\n")
        .map_err(|err| format!("Failed to finalize diagnostic log entry: {err}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn append_frontend_diagnostic(
    source: String,
    label: String,
    payload: Option<Value>,
    app: AppHandle,
) -> Result<(), String> {
    append_app_diagnostic(&app, &source, &label, payload.unwrap_or(Value::Null))
}

#[tauri::command]
pub(crate) fn get_diagnostic_log_path(app: AppHandle) -> Result<String, String> {
    Ok(diagnostic_log_path(&app)?.display().to_string())
}
