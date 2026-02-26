use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

use crate::codex::home::resolve_default_codex_home;
use crate::types::AppSettings;

const DEFAULT_PLUGIN_DIR_NAME: &str = "codex-monitor-plugins";
const PLUGIN_DATA_DIR_NAME: &str = "plugins-data";
const DEFAULT_PLUGIN_ENTRY: &str = "dist/index.js";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) entry: Option<String>,
    #[serde(default)]
    pub(crate) permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginDescriptor {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) description: Option<String>,
    pub(crate) directory: String,
    pub(crate) entry: String,
    pub(crate) entry_path: String,
    pub(crate) enabled: bool,
    pub(crate) valid: bool,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginDataResponse {
    pub(crate) exists: bool,
    pub(crate) content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginEntryResponse {
    pub(crate) entry_path: String,
    pub(crate) content: String,
}

pub(crate) fn default_plugin_dirs() -> Vec<String> {
    let Some(codex_home) = resolve_default_codex_home() else {
        return Vec::new();
    };
    vec![
        codex_home
            .join(DEFAULT_PLUGIN_DIR_NAME)
            .to_string_lossy()
            .to_string(),
    ]
}

fn normalize_entry(entry: Option<&str>) -> String {
    entry
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PLUGIN_ENTRY)
        .to_string()
}

fn normalize_id(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .collect()
}

fn is_enabled(settings: &AppSettings, plugin_id: &str) -> bool {
    settings.plugins_enabled
        && !settings
            .disabled_plugin_ids
            .iter()
            .any(|id| id.trim().eq_ignore_ascii_case(plugin_id))
}

fn plugin_data_path(data_dir: &Path, plugin_id: &str) -> Result<PathBuf, String> {
    let normalized = normalize_id(plugin_id);
    if normalized.is_empty() {
        return Err("Invalid plugin id.".to_string());
    }
    Ok(data_dir
        .join(PLUGIN_DATA_DIR_NAME)
        .join(format!("{normalized}.json")))
}

fn parse_manifest_from_dir(dir: &Path, settings: &AppSettings) -> PluginDescriptor {
    let fallback_id = dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| "unknown".to_string());
    let manifest_path = dir.join("manifest.json");
    let directory = dir.to_string_lossy().to_string();

    let data = match fs::read_to_string(&manifest_path) {
        Ok(value) => value,
        Err(err) => {
            let entry = normalize_entry(None);
            let entry_path = dir.join(&entry).to_string_lossy().to_string();
            return PluginDescriptor {
                id: fallback_id.clone(),
                name: fallback_id.clone(),
                version: "0.0.0".to_string(),
                description: None,
                directory,
                entry,
                entry_path,
                enabled: is_enabled(settings, &fallback_id),
                valid: false,
                error: Some(format!("Failed to read manifest.json: {err}")),
            };
        }
    };

    let manifest: PluginManifest = match serde_json::from_str(&data) {
        Ok(value) => value,
        Err(err) => {
            let entry = normalize_entry(None);
            let entry_path = dir.join(&entry).to_string_lossy().to_string();
            return PluginDescriptor {
                id: fallback_id.clone(),
                name: fallback_id.clone(),
                version: "0.0.0".to_string(),
                description: None,
                directory,
                entry,
                entry_path,
                enabled: is_enabled(settings, &fallback_id),
                valid: false,
                error: Some(format!("Invalid manifest.json: {err}")),
            };
        }
    };

    let id = if manifest.id.trim().is_empty() {
        fallback_id
    } else {
        manifest.id.trim().to_string()
    };
    let name = if manifest.name.trim().is_empty() {
        id.clone()
    } else {
        manifest.name.trim().to_string()
    };
    let version = if manifest.version.trim().is_empty() {
        "0.0.0".to_string()
    } else {
        manifest.version.trim().to_string()
    };
    let entry = normalize_entry(manifest.entry.as_deref());
    let entry_path = dir.join(&entry);
    let valid = entry_path.is_file();
    let error = if valid {
        None
    } else {
        Some("Plugin entry file is missing.".to_string())
    };

    PluginDescriptor {
        id: id.clone(),
        name,
        version,
        description: manifest.description.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        directory,
        entry,
        entry_path: entry_path.to_string_lossy().to_string(),
        enabled: is_enabled(settings, &id),
        valid,
        error,
    }
}

fn collect_plugins(settings: &AppSettings) -> Vec<PluginDescriptor> {
    let mut plugins = Vec::new();
    for root in &settings.plugin_dirs {
        let trimmed = root.trim();
        if trimmed.is_empty() {
            continue;
        }
        let root_path = PathBuf::from(trimmed);
        if !root_path.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&root_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            plugins.push(parse_manifest_from_dir(&path, settings));
        }
    }
    plugins.sort_by(|a, b| {
        a.id.to_ascii_lowercase()
            .cmp(&b.id.to_ascii_lowercase())
            .then_with(|| a.directory.cmp(&b.directory))
    });
    plugins
}

pub(crate) async fn list_plugins_core(
    app_settings: &Mutex<AppSettings>,
) -> Result<Vec<PluginDescriptor>, String> {
    let settings = app_settings.lock().await.clone();
    Ok(collect_plugins(&settings))
}

pub(crate) async fn plugin_entry_read_core(
    app_settings: &Mutex<AppSettings>,
    plugin_id: &str,
    directory: Option<&str>,
) -> Result<PluginEntryResponse, String> {
    let normalized_id = plugin_id.trim();
    if normalized_id.is_empty() {
        return Err("Invalid plugin id.".to_string());
    }
    let normalized_directory = directory
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let settings = app_settings.lock().await.clone();
    let plugin = collect_plugins(&settings)
        .into_iter()
        .find(|candidate| {
            if !candidate.id.eq_ignore_ascii_case(normalized_id) {
                return false;
            }
            match normalized_directory {
                Some(expected_directory) => candidate.directory == expected_directory,
                None => true,
            }
        })
        .ok_or_else(|| "Plugin not found.".to_string())?;

    if !plugin.valid {
        return Err(
            plugin
                .error
                .unwrap_or_else(|| "Plugin entry file is missing.".to_string()),
        );
    }

    if !plugin.enabled {
        return Err("Plugin is disabled.".to_string());
    }

    let content = fs::read_to_string(&plugin.entry_path)
        .map_err(|err| format!("Failed to read plugin entry: {err}"))?;
    Ok(PluginEntryResponse {
        entry_path: plugin.entry_path,
        content,
    })
}

pub(crate) fn plugin_data_read_core(
    data_dir: &Path,
    plugin_id: &str,
) -> Result<PluginDataResponse, String> {
    let path = plugin_data_path(data_dir, plugin_id)?;
    if !path.is_file() {
        return Ok(PluginDataResponse {
            exists: false,
            content: String::new(),
        });
    }
    let content = fs::read_to_string(&path).map_err(|err| format!("Failed to read file: {err}"))?;
    Ok(PluginDataResponse {
        exists: true,
        content,
    })
}

pub(crate) fn plugin_data_write_core(
    data_dir: &Path,
    plugin_id: &str,
    content: &str,
) -> Result<(), String> {
    let path = plugin_data_path(data_dir, plugin_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Failed to create directory: {err}"))?;
    }
    fs::write(path, content).map_err(|err| format!("Failed to write file: {err}"))
}
