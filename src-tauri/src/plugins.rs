use tauri::State;

use crate::shared::plugins_core::{
    list_plugins_core, plugin_data_read_core, plugin_data_write_core, plugin_entry_read_core,
    PluginDataResponse, PluginDescriptor, PluginEntryResponse,
};
use crate::state::AppState;

#[tauri::command]
pub(crate) async fn list_plugins(
    state: State<'_, AppState>,
) -> Result<Vec<PluginDescriptor>, String> {
    list_plugins_core(&state.app_settings).await
}

#[tauri::command]
pub(crate) async fn plugin_data_read(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<PluginDataResponse, String> {
    let data_dir = state
        .settings_path
        .parent()
        .ok_or_else(|| "Unable to resolve app data directory.".to_string())?;
    plugin_data_read_core(data_dir, &plugin_id)
}

#[tauri::command]
pub(crate) async fn plugin_data_write(
    state: State<'_, AppState>,
    plugin_id: String,
    content: String,
) -> Result<(), String> {
    let data_dir = state
        .settings_path
        .parent()
        .ok_or_else(|| "Unable to resolve app data directory.".to_string())?;
    plugin_data_write_core(data_dir, &plugin_id, &content)
}

#[tauri::command]
pub(crate) async fn plugin_entry_read(
    state: State<'_, AppState>,
    plugin_id: String,
    directory: Option<String>,
) -> Result<PluginEntryResponse, String> {
    plugin_entry_read_core(&state.app_settings, &plugin_id, directory.as_deref()).await
}
