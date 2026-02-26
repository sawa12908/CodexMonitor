use super::*;

pub(super) async fn try_handle(
    state: &DaemonState,
    method: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    match method {
        "ping" => Some(Ok(json!({ "ok": true }))),
        "daemon_info" => Some(Ok(state.daemon_info())),
        "daemon_shutdown" => {
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                std::process::exit(0);
            });
            Some(Ok(json!({ "ok": true })))
        }
        "menu_set_accelerators" => {
            let updates: Vec<Value> = match params {
                Value::Object(map) => match map
                    .get("updates")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                {
                    Ok(value) => value.unwrap_or_default(),
                    Err(err) => return Some(Err(err.to_string())),
                },
                _ => Vec::new(),
            };
            Some(
                state
                    .menu_set_accelerators(updates)
                    .await
                .map(|_| json!({ "ok": true })),
            )
        }
        "list_plugins" => Some(
            state
                .list_plugins()
                .await
                .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
        ),
        "plugin_data_read" => {
            let plugin_id = match parse_string(params, "pluginId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .plugin_data_read(plugin_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "plugin_data_write" => {
            let plugin_id = match parse_string(params, "pluginId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let content = match parse_string(params, "content") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .plugin_data_write(plugin_id, content)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        "plugin_entry_read" => {
            let plugin_id = match parse_string(params, "pluginId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let directory = parse_optional_string(params, "directory");
            Some(
                state
                    .plugin_entry_read(plugin_id, directory)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "is_macos_debug_build" => {
            let is_debug = state.is_macos_debug_build().await;
            Some(Ok(Value::Bool(is_debug)))
        }
        "send_notification_fallback" => {
            let title = match parse_string(params, "title") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let body = match parse_string(params, "body") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .send_notification_fallback(title, body)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        _ => None,
    }
}
