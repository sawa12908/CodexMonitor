use std::collections::{BTreeMap, HashMap, HashSet};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use bytes::Bytes;
use chrono::Utc;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::{AUTHORIZATION, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::shared::codex_core::list_threads_core;
use crate::state::AppState;
use crate::types::WorkspaceEntry;

const DEFAULT_RESEARCH_PORT: u16 = 47632;
const RESEARCH_EVENT_NAME: &str = "research-run-event";
const MAX_FINISHED_RUNS_PER_WORKSPACE: usize = 20;
const MAX_LOG_ENTRIES: usize = 24;

type MetricsMap = BTreeMap<String, Value>;
type ResponseBody = Full<Bytes>;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResearchRunStatus {
    Created,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResearchDeliveryStatus {
    Idle,
    Queued,
    Sending,
    Sent,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ResearchLogKind {
    Progress,
    Completed,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchRunLogEntry {
    pub(crate) id: String,
    pub(crate) at: i64,
    pub(crate) kind: ResearchLogKind,
    pub(crate) stage_label: String,
    pub(crate) message: String,
    pub(crate) progress_pct: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchRun {
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) bound_thread_id: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) round_number: Option<u32>,
    pub(crate) status: ResearchRunStatus,
    pub(crate) progress_pct: u8,
    pub(crate) stage_label: String,
    pub(crate) latest_message: String,
    #[serde(default)]
    pub(crate) metrics: MetricsMap,
    #[serde(default)]
    pub(crate) primary_result_path: Option<String>,
    #[serde(default)]
    pub(crate) result_paths: Vec<String>,
    #[serde(default)]
    pub(crate) result_summary: Option<String>,
    #[serde(default)]
    pub(crate) result_preview: Option<String>,
    pub(crate) delivery_status: ResearchDeliveryStatus,
    #[serde(default)]
    pub(crate) delivery_error: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    #[serde(default)]
    pub(crate) completed_at: Option<i64>,
    #[serde(default)]
    pub(crate) dismissed: bool,
    #[serde(default)]
    pub(crate) logs: Vec<ResearchRunLogEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchApiConfig {
    pub(crate) base_url: Option<String>,
    pub(crate) auth_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchStore {
    pub(crate) auth_token: String,
    #[serde(default)]
    pub(crate) base_url: Option<String>,
    #[serde(default)]
    pub(crate) runs: Vec<ResearchRun>,
}

pub(crate) struct ResearchRuntime {
    pub(crate) store_path: PathBuf,
    pub(crate) auth_token: String,
    pub(crate) runs: HashMap<String, ResearchRun>,
    pub(crate) base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressRequest {
    stage: String,
    progress_pct: u8,
    message: String,
    #[serde(default)]
    metrics: MetricsMap,
    #[serde(default)]
    primary_result_path: Option<String>,
    #[serde(default)]
    updated_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRunRequest {
    title: String,
    #[serde(default)]
    workspace_id: Option<String>,
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    workspace_path: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteRequest {
    summary: String,
    #[serde(default)]
    metrics: MetricsMap,
    primary_result_path: String,
    result_paths: Vec<String>,
    #[serde(default)]
    result_preview: Option<String>,
    #[serde(default)]
    completed_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailRequest {
    error: String,
    #[serde(default)]
    metrics: MetricsMap,
    #[serde(default)]
    failed_at: Option<i64>,
}

impl Default for ResearchStore {
    fn default() -> Self {
        Self {
            auth_token: generate_research_token(),
            base_url: None,
            runs: Vec::new(),
        }
    }
}

fn read_research_store(path: &PathBuf) -> Result<ResearchStore, String> {
    if !path.exists() {
        return Ok(ResearchStore::default());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn write_research_store(path: &PathBuf, store: &ResearchStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

impl ResearchRuntime {
    pub(crate) fn load(store_path: PathBuf) -> Self {
        let mut store = read_research_store(&store_path).unwrap_or_else(|_| ResearchStore::default());
        trim_finished_runs(&mut store.runs);
        let mut runs = HashMap::new();
        for run in store.runs {
            runs.insert(run.id.clone(), run);
        }
        Self {
            store_path,
            auth_token: if store.auth_token.trim().is_empty() {
                generate_research_token()
            } else {
                store.auth_token
            },
            runs,
            base_url: store.base_url,
        }
    }

    fn persist(&mut self) -> Result<(), String> {
        let mut runs = self.runs.values().cloned().collect::<Vec<_>>();
        trim_finished_runs(&mut runs);
        runs.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.created_at.cmp(&left.created_at))
        });
        self.runs = runs
            .iter()
            .cloned()
            .map(|run| (run.id.clone(), run))
            .collect();
        write_research_store(
            &self.store_path,
            &ResearchStore {
                auth_token: self.auth_token.clone(),
                base_url: self.base_url.clone(),
                runs,
            },
        )
    }
}

pub(crate) fn initialize(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = start_server(app.clone()).await {
            eprintln!("[research] failed to start loopback server: {error}");
        }
    });
}

#[tauri::command]
pub(crate) async fn get_research_api_config(
    state: State<'_, AppState>,
) -> Result<ResearchApiConfig, String> {
    let runtime = state.research.lock().await;
    Ok(ResearchApiConfig {
        base_url: runtime.base_url.clone(),
        auth_token: runtime.auth_token.clone(),
    })
}

#[tauri::command]
pub(crate) async fn list_research_runs(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ResearchRun>, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Ok(Vec::new());
    }
    let runtime = state.research.lock().await;
    let mut runs = runtime
        .runs
        .values()
        .filter(|run| run.workspace_id == workspace_id && !run.dismissed)
        .cloned()
        .collect::<Vec<_>>();
    runs.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.created_at.cmp(&left.created_at))
    });
    Ok(runs)
}

#[tauri::command]
pub(crate) async fn create_research_run(
    workspace_id: String,
    thread_id: String,
    title: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ResearchRun, String> {
    let workspace_id = workspace_id.trim();
    let thread_id = thread_id.trim();
    let title = title.trim();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    if thread_id.is_empty() {
        return Err("thread_id is required".to_string());
    }
    if title.is_empty() {
        return Err("title is required".to_string());
    }

    let run = create_run_record(&state.research, workspace_id, thread_id, title).await?;
    emit_research_event(&app, &run);
    Ok(run)
}

#[tauri::command]
pub(crate) async fn retry_research_delivery(
    run_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ResearchRun, String> {
    let run = update_run(&state.research, &run_id, |run| {
        if run.status != ResearchRunStatus::Completed {
            return Err("Only completed research runs can be re-delivered.".to_string());
        }
        if run.delivery_status == ResearchDeliveryStatus::Sent {
            return Ok(());
        }
        run.delivery_status = ResearchDeliveryStatus::Queued;
        run.delivery_error = None;
        run.updated_at = now_ms();
        Ok(())
    })
    .await?;
    emit_research_event(&app, &run);
    Ok(run)
}

#[tauri::command]
pub(crate) async fn dismiss_research_run(
    run_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ResearchRun, String> {
    let run = update_run(&state.research, &run_id, |run| {
        run.dismissed = true;
        run.updated_at = now_ms();
        Ok(())
    })
    .await?;
    emit_research_event(&app, &run);
    Ok(run)
}

#[tauri::command]
pub(crate) async fn set_research_run_delivery_status(
    run_id: String,
    delivery_status: ResearchDeliveryStatus,
    error_message: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ResearchRun, String> {
    let run = update_run(&state.research, &run_id, |run| {
        if run.status != ResearchRunStatus::Completed {
            return Err("Only completed research runs can update delivery status.".to_string());
        }
        if run.delivery_status == delivery_status {
            return Ok(());
        }
        if !is_valid_delivery_transition(&run.delivery_status, &delivery_status) {
            return Err("Invalid research delivery state transition.".to_string());
        }
        run.delivery_status = delivery_status;
        run.delivery_error = if run.delivery_status == ResearchDeliveryStatus::Failed {
            error_message
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        } else {
            None
        };
        run.updated_at = now_ms();
        Ok(())
    })
    .await?;
    emit_research_event(&app, &run);
    Ok(run)
}

async fn start_server(app: AppHandle) -> Result<(), String> {
    let listener = bind_research_listener().await?;
    let local_addr = listener.local_addr().map_err(|error| error.to_string())?;
    {
        let state = app.state::<AppState>();
        let mut runtime = state.research.lock().await;
        runtime.base_url = Some(format!("http://{local_addr}"));
        runtime.persist()?;
    }

    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |request| handle_http_request(app_handle.clone(), request));
            if let Err(error) = http1::Builder::new().serve_connection(io, service).await {
                eprintln!("[research] request failed: {error}");
            }
        });
    }
}

async fn bind_research_listener() -> Result<TcpListener, String> {
    let primary = SocketAddr::from(([127, 0, 0, 1], DEFAULT_RESEARCH_PORT));
    match TcpListener::bind(primary).await {
        Ok(listener) => Ok(listener),
        Err(_) => TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|error| error.to_string()),
    }
}

async fn handle_http_request(
    app: AppHandle,
    request: Request<Incoming>,
) -> Result<Response<ResponseBody>, Infallible> {
    let response = match handle_http_request_impl(app, request).await {
        Ok(response) => response,
        Err(error) => json_response(
            error.status,
            json!({
                "ok": false,
                "error": error.message,
            }),
        ),
    };
    Ok(response)
}

async fn handle_http_request_impl(
    app: AppHandle,
    request: Request<Incoming>,
) -> Result<Response<ResponseBody>, ApiError> {
    if request.method() != Method::POST {
        return Err(ApiError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Only POST is supported.",
        ));
    }

    authorize_request(&app, request.headers().get(AUTHORIZATION)).await?;
    let path = request.uri().path().trim_matches('/').to_string();
    if path == "v1/research-runs" {
        let body_bytes = request
            .into_body()
            .collect()
            .await
            .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?
            .to_bytes();
        let payload = parse_json_body::<CreateRunRequest>(body_bytes)?;
        let run = create_run_from_external_request(&app, payload).await?;
        return Ok(json_response(
            StatusCode::CREATED,
            json!({
                "ok": true,
                "run": run,
            }),
        ));
    }

    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() != 4 || parts[0] != "v1" || parts[1] != "research-runs" {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Unknown research endpoint."));
    }
    let run_id = parts[2].trim();
    if run_id.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "runId is required."));
    }
    let action = parts[3];
    let body_bytes = request
        .into_body()
        .collect()
        .await
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))?
        .to_bytes();

    let run = match action {
        "progress" => {
            let payload = parse_json_body::<ProgressRequest>(body_bytes)?;
            apply_progress(&app, run_id, payload).await?
        }
        "complete" => {
            let payload = parse_json_body::<CompleteRequest>(body_bytes)?;
            apply_complete(&app, run_id, payload).await?
        }
        "fail" => {
            let payload = parse_json_body::<FailRequest>(body_bytes)?;
            apply_failure(&app, run_id, payload).await?
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "Unknown research action.",
            ))
        }
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(
            json!({
                "ok": true,
                "run": run,
            })
            .to_string(),
        )))
        .expect("research response"))
}

async fn authorize_request(
    app: &AppHandle,
    authorization_header: Option<&hyper::header::HeaderValue>,
) -> Result<(), ApiError> {
    let state = app.state::<AppState>();
    let runtime = state.research.lock().await;
    let expected = format!("Bearer {}", runtime.auth_token);
    let provided = authorization_header
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .trim()
        .to_string();
    if provided != expected {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Missing or invalid bearer token.",
        ));
    }
    Ok(())
}

fn parse_json_body<T: for<'de> Deserialize<'de>>(body: Bytes) -> Result<T, ApiError> {
    serde_json::from_slice::<T>(&body)
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error.to_string()))
}

async fn create_run_from_external_request(
    app: &AppHandle,
    payload: CreateRunRequest,
) -> Result<ResearchRun, ApiError> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "title is required."));
    }

    let state = app.state::<AppState>();
    let binding = resolve_external_run_binding(&state, &payload).await?;
    let run = create_run_record(
        &state.research,
        binding.workspace_id.as_str(),
        binding.thread_id.as_str(),
        title,
    )
    .await
    .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    emit_research_event(app, &run);
    Ok(run)
}

async fn apply_progress(
    app: &AppHandle,
    run_id: &str,
    payload: ProgressRequest,
) -> Result<ResearchRun, ApiError> {
    let stage = payload.stage.trim();
    let message = payload.message.trim();
    if stage.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "stage is required."));
    }
    if message.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "message is required."));
    }
    if let Some(path) = payload.primary_result_path.as_deref() {
        validate_absolute_path(path)?;
    }

    let state = app.state::<AppState>();
    let run = update_run(&state.research, run_id, |run| {
        if run.dismissed {
            return Err("Dismissed research runs cannot receive progress updates.".to_string());
        }
        if matches!(
            run.status,
            ResearchRunStatus::Completed | ResearchRunStatus::Failed
        ) {
            return Err("Finished research runs cannot receive progress updates.".to_string());
        }
        run.status = ResearchRunStatus::Running;
        run.progress_pct = payload.progress_pct;
        run.stage_label = stage.to_string();
        run.latest_message = message.to_string();
        run.metrics = payload.metrics.clone();
        if let Some(primary_result_path) = payload.primary_result_path.as_ref() {
            run.primary_result_path = Some(primary_result_path.clone());
            run.round_number = resolve_round_number(
                run.primary_result_path.as_deref(),
                &run.result_paths,
            );
        }
        run.updated_at = payload.updated_at.unwrap_or_else(now_ms);
        push_log_entry(
            &mut run.logs,
            ResearchRunLogEntry {
                id: format!("log-{}", Uuid::new_v4()),
                at: run.updated_at,
                kind: ResearchLogKind::Progress,
                stage_label: stage.to_string(),
                message: message.to_string(),
                progress_pct: payload.progress_pct,
            },
        );
        Ok(())
    })
    .await
    .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    emit_research_event(app, &run);
    Ok(run)
}

async fn apply_complete(
    app: &AppHandle,
    run_id: &str,
    payload: CompleteRequest,
) -> Result<ResearchRun, ApiError> {
    let summary = payload.summary.trim();
    if summary.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "summary is required."));
    }
    validate_absolute_path(&payload.primary_result_path)?;
    if payload.result_paths.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "resultPaths must include at least one absolute path.",
        ));
    }
    for path in &payload.result_paths {
        validate_absolute_path(path)?;
    }

    let state = app.state::<AppState>();
    let completed_at = payload.completed_at.unwrap_or_else(now_ms);
    let run = update_run(&state.research, run_id, |run| {
        mark_run_completed(run, &payload, summary, completed_at)
    })
    .await
    .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    emit_research_event(app, &run);
    Ok(run)
}

async fn apply_failure(
    app: &AppHandle,
    run_id: &str,
    payload: FailRequest,
) -> Result<ResearchRun, ApiError> {
    let error_message = payload.error.trim();
    if error_message.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "error is required."));
    }
    let failed_at = payload.failed_at.unwrap_or_else(now_ms);
    let state = app.state::<AppState>();
    let run = update_run(&state.research, run_id, |run| {
        if run.dismissed {
            return Err("Dismissed research runs cannot fail.".to_string());
        }
        if run.status == ResearchRunStatus::Completed {
            return Err("Completed research runs cannot be marked as failed.".to_string());
        }
        if run.status == ResearchRunStatus::Failed {
            return Ok(());
        }
        run.status = ResearchRunStatus::Failed;
        run.stage_label = "Failed".to_string();
        run.latest_message = error_message.to_string();
        run.metrics = payload.metrics.clone();
        run.updated_at = failed_at;
        run.completed_at = Some(failed_at);
        push_log_entry(
            &mut run.logs,
            ResearchRunLogEntry {
                id: format!("log-{}", Uuid::new_v4()),
                at: failed_at,
                kind: ResearchLogKind::Failed,
                stage_label: "failed".to_string(),
                message: error_message.to_string(),
                progress_pct: run.progress_pct,
            },
        );
        Ok(())
    })
    .await
    .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, error))?;
    emit_research_event(app, &run);
    Ok(run)
}

async fn update_run<F>(
    research_state: &Mutex<ResearchRuntime>,
    run_id: &str,
    mutator: F,
) -> Result<ResearchRun, String>
where
    F: FnOnce(&mut ResearchRun) -> Result<(), String>,
{
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err("runId is required.".to_string());
    }
    let mut runtime = research_state.lock().await;
    let run = runtime
        .runs
        .get_mut(run_id)
        .ok_or_else(|| "Research run not found.".to_string())?;
    mutator(run)?;
    let updated = run.clone();
    runtime.persist()?;
    Ok(updated)
}

fn mark_run_completed(
    run: &mut ResearchRun,
    payload: &CompleteRequest,
    summary: &str,
    completed_at: i64,
) -> Result<(), String> {
    if run.dismissed {
        return Err("Dismissed research runs cannot be completed.".to_string());
    }
    if run.status == ResearchRunStatus::Completed {
        return Ok(());
    }
    if run.status == ResearchRunStatus::Failed {
        return Err("Failed research runs cannot be completed.".to_string());
    }

    run.status = ResearchRunStatus::Completed;
    run.progress_pct = 100;
    run.stage_label = "Completed".to_string();
    run.latest_message = "Research run completed.".to_string();
    run.metrics = payload.metrics.clone();
    run.primary_result_path = Some(payload.primary_result_path.clone());
    run.result_paths = payload.result_paths.clone();
    run.result_summary = Some(summary.to_string());
    run.result_preview = payload.result_preview.clone();
    run.round_number = resolve_round_number(run.primary_result_path.as_deref(), &run.result_paths);
    run.completed_at = Some(completed_at);
    run.updated_at = completed_at;
    if run.delivery_status != ResearchDeliveryStatus::Sent {
        run.delivery_status = ResearchDeliveryStatus::Idle;
        run.delivery_error = None;
    }
    push_log_entry(
        &mut run.logs,
        ResearchRunLogEntry {
            id: format!("log-{}", Uuid::new_v4()),
            at: completed_at,
            kind: ResearchLogKind::Completed,
            stage_label: "completed".to_string(),
            message: summary.to_string(),
            progress_pct: 100,
        },
    );
    Ok(())
}

fn is_valid_delivery_transition(
    current: &ResearchDeliveryStatus,
    next: &ResearchDeliveryStatus,
) -> bool {
    use ResearchDeliveryStatus as Status;

    if current == next {
        return true;
    }

    matches!(
        (current, next),
        (Status::Idle, Status::Queued | Status::Sending | Status::Failed)
            | (Status::Queued, Status::Sending | Status::Failed)
            | (Status::Sending, Status::Queued | Status::Sent | Status::Failed)
            | (Status::Failed, Status::Queued | Status::Sending)
    )
}

fn emit_research_event(app: &AppHandle, run: &ResearchRun) {
    let _ = app.emit(RESEARCH_EVENT_NAME, run);
}

async fn create_run_record(
    research_state: &Mutex<ResearchRuntime>,
    workspace_id: &str,
    thread_id: &str,
    title: &str,
) -> Result<ResearchRun, String> {
    let now = now_ms();
    let run = build_research_run(workspace_id, thread_id, title, now);
    let mut runtime = research_state.lock().await;
    runtime.runs.insert(run.id.clone(), run.clone());
    runtime.persist()?;
    Ok(run)
}

fn build_research_run(workspace_id: &str, thread_id: &str, title: &str, now: i64) -> ResearchRun {
    ResearchRun {
        id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        bound_thread_id: thread_id.to_string(),
        title: title.to_string(),
        round_number: None,
        status: ResearchRunStatus::Created,
        progress_pct: 0,
        stage_label: "Waiting for progress".to_string(),
        latest_message: "Research run created.".to_string(),
        metrics: MetricsMap::new(),
        primary_result_path: None,
        result_paths: Vec::new(),
        result_summary: None,
        result_preview: None,
        delivery_status: ResearchDeliveryStatus::Idle,
        delivery_error: None,
        created_at: now,
        updated_at: now,
        completed_at: None,
        dismissed: false,
        logs: vec![ResearchRunLogEntry {
            id: format!("log-{}", Uuid::new_v4()),
            at: now,
            kind: ResearchLogKind::Progress,
            stage_label: "created".to_string(),
            message: "Research run created.".to_string(),
            progress_pct: 0,
        }],
    }
}

struct ResolvedRunBinding {
    workspace_id: String,
    thread_id: String,
}

async fn resolve_external_run_binding(
    state: &State<'_, AppState>,
    payload: &CreateRunRequest,
) -> Result<ResolvedRunBinding, ApiError> {
    let workspace_id = resolve_workspace_id_for_external_run(state, payload).await?;
    let thread_id = if let Some(thread_id) = payload
        .thread_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        thread_id.to_string()
    } else {
        resolve_latest_thread_id(state, &workspace_id).await?
    };

    Ok(ResolvedRunBinding {
        workspace_id,
        thread_id,
    })
}

async fn resolve_workspace_id_for_external_run(
    state: &State<'_, AppState>,
    payload: &CreateRunRequest,
) -> Result<String, ApiError> {
    if let Some(workspace_id) = payload
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let workspaces = state.workspaces.lock().await;
        if workspaces.contains_key(workspace_id) {
            return Ok(workspace_id.to_string());
        }
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Unknown workspaceId: {workspace_id}"),
        ));
    }

    let path_hint = payload
        .workspace_path
        .as_deref()
        .or(payload.cwd.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let workspaces = state.workspaces.lock().await;
    if let Some(path_hint) = path_hint {
        if let Some(workspace_id) = resolve_workspace_id_from_path(&workspaces, path_hint) {
            return Ok(workspace_id);
        }
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Unable to match workspace for path: {path_hint}"),
        ));
    }

    if workspaces.len() == 1 {
        if let Some(workspace_id) = workspaces.keys().next() {
            return Ok(workspace_id.clone());
        }
    }

    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        "workspaceId or workspacePath is required when multiple workspaces are open.",
    ))
}

fn resolve_workspace_id_from_path(
    workspaces: &HashMap<String, WorkspaceEntry>,
    candidate_path: &str,
) -> Option<String> {
    let normalized_candidate = normalize_workspace_root(candidate_path);
    if normalized_candidate.is_empty() {
        return None;
    }

    let mut best_match: Option<(usize, String)> = None;
    for (workspace_id, entry) in workspaces {
        let normalized_workspace = normalize_workspace_root(&entry.path);
        if normalized_workspace.is_empty() {
            continue;
        }
        let matches = normalized_candidate == normalized_workspace
            || normalized_candidate.starts_with(&(normalized_workspace.clone() + "/"));
        if !matches {
            continue;
        }
        let should_replace = match best_match.as_ref() {
            Some((length, _)) => normalized_workspace.len() > *length,
            None => true,
        };
        if should_replace {
            best_match = Some((normalized_workspace.len(), workspace_id.clone()));
        }
    }

    best_match.map(|(_, workspace_id)| workspace_id)
}

fn normalize_workspace_root(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        return String::new();
    }

    let lower = normalized.to_ascii_lowercase();
    let normalized = if lower.starts_with("//?/unc/") {
        format!("//{}", &normalized[8..])
    } else if lower.starts_with("//?/") || lower.starts_with("//./") {
        normalized[4..].to_string()
    } else {
        normalized.to_string()
    };
    if normalized.is_empty() {
        return String::new();
    }

    let bytes = normalized.as_bytes();
    let is_drive_path = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'/';
    if is_drive_path || normalized.starts_with("//") {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

async fn resolve_latest_thread_id(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<String, ApiError> {
    let runtime = state.research.lock().await;
    let fallback_thread = runtime
        .runs
        .values()
        .filter(|run| run.workspace_id == workspace_id && !run.bound_thread_id.trim().is_empty())
        .max_by(|left, right| {
            left.updated_at
                .cmp(&right.updated_at)
                .then_with(|| left.created_at.cmp(&right.created_at))
        })
        .map(|run| run.bound_thread_id.clone());
    drop(runtime);

    if let Some(thread_id) = fallback_thread {
        return Ok(thread_id);
    }

    let latest_thread = list_threads_core(
        &state.sessions,
        workspace_id.to_string(),
        None,
        Some(50),
        Some("updated_at".to_string()),
    )
    .await
    .ok()
    .and_then(|value| extract_first_thread_id(&value));

    if let Some(thread_id) = latest_thread {
        return Ok(thread_id);
    }

    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        "Unable to resolve a thread for this workspace. Open the workspace in CodexMonitor or provide threadId explicitly.",
    ))
}

fn extract_first_thread_id(value: &Value) -> Option<String> {
    if let Some(values) = value.as_array() {
        for entry in values {
            if let Some(thread_id) = extract_first_thread_id(entry) {
                return Some(thread_id);
            }
        }
        return None;
    }

    let object = value.as_object()?;
    if let Some(thread_id) = object
        .get("threadId")
        .or_else(|| object.get("thread_id"))
        .or_else(|| object.get("id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(thread_id.to_string());
    }
    if let Some(thread_id) = object
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(thread_id.to_string());
    }

    for key in ["threads", "items", "results", "data"] {
        if let Some(next) = object.get(key) {
            if let Some(thread_id) = extract_first_thread_id(next) {
                return Some(thread_id);
            }
        }
    }

    None
}

fn json_response(status: StatusCode, value: Value) -> Response<ResponseBody> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(value.to_string())))
        .expect("research json response")
}

fn generate_research_token() -> String {
    format!("research-{}", Uuid::new_v4().simple())
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn validate_absolute_path(path: &str) -> Result<(), ApiError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Result path cannot be empty."));
    }
    if !Path::new(trimmed).is_absolute() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Result path must be absolute: {trimmed}"),
        ));
    }
    Ok(())
}

fn trim_finished_runs(runs: &mut Vec<ResearchRun>) {
    let mut keep_finished_ids = HashSet::new();
    let mut finished_by_workspace: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for run in runs.iter() {
        if matches!(
            run.status,
            ResearchRunStatus::Completed | ResearchRunStatus::Failed
        ) {
            finished_by_workspace
                .entry(run.workspace_id.clone())
                .or_default()
                .push((run.id.clone(), run.completed_at.unwrap_or(run.updated_at)));
        }
    }
    for entries in finished_by_workspace.values_mut() {
        entries.sort_by(|left, right| right.1.cmp(&left.1));
        for (id, _) in entries.iter().take(MAX_FINISHED_RUNS_PER_WORKSPACE) {
            keep_finished_ids.insert(id.clone());
        }
    }
    runs.retain(|run| {
        !matches!(
            run.status,
            ResearchRunStatus::Completed | ResearchRunStatus::Failed
        ) || keep_finished_ids.contains(&run.id)
    });
}

fn push_log_entry(logs: &mut Vec<ResearchRunLogEntry>, entry: ResearchRunLogEntry) {
    logs.push(entry);
    if logs.len() > MAX_LOG_ENTRIES {
        let excess = logs.len().saturating_sub(MAX_LOG_ENTRIES);
        logs.drain(0..excess);
    }
}

fn resolve_round_number(primary_result_path: Option<&str>, result_paths: &[String]) -> Option<u32> {
    if let Some(path) = primary_result_path {
        if let Some(round) = parse_round_number(path) {
            return Some(round);
        }
    }
    result_paths
        .iter()
        .find_map(|path| parse_round_number(path.as_str()))
}

fn parse_round_number(path: &str) -> Option<u32> {
    let file_name = Path::new(path).file_name()?.to_string_lossy().to_ascii_lowercase();
    let bytes = file_name.as_bytes();
    let mut cursor = 0usize;
    while let Some(relative_index) = file_name[cursor..].find("round_") {
        let marker_index = cursor + relative_index;
        let marker_start = marker_index + "round_".len();
        let boundary_before_ok =
            marker_index == 0 || !bytes[marker_index.saturating_sub(1)].is_ascii_alphanumeric();
        if !boundary_before_ok {
            cursor = marker_index + 1;
            continue;
        }
        let mut digit_end = marker_start;
        while digit_end < bytes.len() && bytes[digit_end].is_ascii_digit() {
            digit_end += 1;
        }
        if digit_end == marker_start {
            cursor = marker_index + 1;
            continue;
        }
        let boundary_after_ok =
            digit_end == bytes.len() || !bytes[digit_end].is_ascii_alphanumeric();
        if boundary_after_ok {
            return file_name[marker_start..digit_end].parse::<u32>().ok();
        }
        cursor = marker_index + 1;
    }
    None
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_research_run, extract_first_thread_id, is_valid_delivery_transition,
        mark_run_completed, normalize_workspace_root, parse_round_number,
        resolve_workspace_id_from_path, trim_finished_runs, write_research_store,
        read_research_store, CompleteRequest, ResearchDeliveryStatus, ResearchRun,
        ResearchRunLogEntry, ResearchRunStatus, ResearchStore,
    };
    use chrono::Utc;
    use std::collections::BTreeMap;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use uuid::Uuid;

    use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use serde_json::json;

    fn make_run(id: usize, workspace: &str, status: ResearchRunStatus, updated_at: i64) -> ResearchRun {
        let mut run = build_research_run(workspace, "thread-1", &format!("Run {id}"), updated_at);
        run.id = format!("run-{id}");
        run.status = status;
        run.created_at = updated_at;
        run.updated_at = updated_at;
        run.completed_at = Some(updated_at);
        run
    }

    #[test]
    fn parse_round_number_reads_round_suffix_case_insensitively() {
        assert_eq!(
            parse_round_number(r"C:\data\etf_research_round_12.json"),
            Some(12)
        );
        assert_eq!(
            parse_round_number(r"C:\data\ETF_Round_7_summary.csv"),
            Some(7)
        );
        assert_eq!(parse_round_number(r"C:\data\summary.json"), None);
        assert_eq!(parse_round_number(r"C:\data\surround_2.json"), None);
        assert_eq!(parse_round_number(r"C:\data\round_12alpha.json"), None);
    }

    #[test]
    fn mark_run_completed_is_idempotent_after_first_completion() {
        let now = Utc::now().timestamp_millis();
        let mut run = make_run(1, "workspace-a", ResearchRunStatus::Running, now);
        run.completed_at = None;
        run.status = ResearchRunStatus::Running;
        run.result_summary = None;
        run.result_paths.clear();
        run.primary_result_path = None;

        let payload = CompleteRequest {
            summary: "Sharpe improved after the new filter.".to_string(),
            metrics: BTreeMap::new(),
            primary_result_path: r"C:\results\strategy_round_12.json".to_string(),
            result_paths: vec![r"C:\results\strategy_round_12.json".to_string()],
            result_preview: None,
            completed_at: Some(now + 10),
        };

        mark_run_completed(&mut run, &payload, payload.summary.trim(), now + 10)
            .expect("first completion should succeed");
        let logs_after_first_complete = run.logs.len();
        let completed_at_after_first_complete = run.completed_at;
        let delivery_status_after_first_complete = run.delivery_status.clone();

        mark_run_completed(&mut run, &payload, payload.summary.trim(), now + 20)
            .expect("second completion should be a no-op");

        assert_eq!(run.logs.len(), logs_after_first_complete);
        assert_eq!(run.completed_at, completed_at_after_first_complete);
        assert_eq!(run.delivery_status, delivery_status_after_first_complete);
        assert_eq!(run.round_number, Some(12));
    }

    #[test]
    fn delivery_status_transitions_only_allow_expected_paths() {
        assert!(is_valid_delivery_transition(
            &ResearchDeliveryStatus::Idle,
            &ResearchDeliveryStatus::Queued
        ));
        assert!(is_valid_delivery_transition(
            &ResearchDeliveryStatus::Queued,
            &ResearchDeliveryStatus::Sending
        ));
        assert!(is_valid_delivery_transition(
            &ResearchDeliveryStatus::Sending,
            &ResearchDeliveryStatus::Sent
        ));
        assert!(is_valid_delivery_transition(
            &ResearchDeliveryStatus::Failed,
            &ResearchDeliveryStatus::Queued
        ));
        assert!(!is_valid_delivery_transition(
            &ResearchDeliveryStatus::Sent,
            &ResearchDeliveryStatus::Queued
        ));
        assert!(!is_valid_delivery_transition(
            &ResearchDeliveryStatus::Queued,
            &ResearchDeliveryStatus::Sent
        ));
    }

    #[test]
    fn trim_finished_runs_keeps_only_recent_completed_per_workspace() {
        let now = Utc::now().timestamp_millis();
        let mut runs = (0..25)
            .map(|index| {
                make_run(
                    index,
                    "workspace-a",
                    ResearchRunStatus::Completed,
                    now - index as i64,
                )
            })
            .collect::<Vec<_>>();
        runs.push(make_run(
            99,
            "workspace-a",
            ResearchRunStatus::Running,
            now + 100,
        ));
        trim_finished_runs(&mut runs);
        let completed_count = runs
            .iter()
            .filter(|run| run.status == ResearchRunStatus::Completed)
            .count();
        assert_eq!(completed_count, 20);
        assert!(runs.iter().any(|run| run.status == ResearchRunStatus::Running));
    }

    #[test]
    fn normalize_workspace_root_handles_windows_prefixes() {
        assert_eq!(
            normalize_workspace_root(r"\\?\C:\Work\Repo\"),
            "c:/work/repo".to_string()
        );
        assert_eq!(
            normalize_workspace_root(r"\\?\UNC\server\share\repo"),
            "//server/share/repo".to_string()
        );
    }

    #[test]
    fn resolve_workspace_id_from_path_prefers_longest_matching_root() {
        let mut workspaces = HashMap::new();
        workspaces.insert(
            "root".to_string(),
            WorkspaceEntry {
                id: "root".to_string(),
                name: "root".to_string(),
                path: r"C:\Work".to_string(),
                kind: WorkspaceKind::Main,
                parent_id: None,
                worktree: None,
                settings: WorkspaceSettings::default(),
            },
        );
        workspaces.insert(
            "repo".to_string(),
            WorkspaceEntry {
                id: "repo".to_string(),
                name: "repo".to_string(),
                path: r"C:\Work\Repo".to_string(),
                kind: WorkspaceKind::Main,
                parent_id: None,
                worktree: None,
                settings: WorkspaceSettings::default(),
            },
        );

        assert_eq!(
            resolve_workspace_id_from_path(&workspaces, r"C:\Work\Repo\qlib_lab\scripts"),
            Some("repo".to_string())
        );
    }

    #[test]
    fn extract_first_thread_id_reads_nested_thread_list_payloads() {
        let payload = json!({
            "items": [
                {
                    "thread": {
                        "id": "thread-alpha"
                    }
                },
                {
                    "id": "thread-beta"
                }
            ]
        });

        assert_eq!(extract_first_thread_id(&payload), Some("thread-alpha".to_string()));
    }

    #[test]
    fn research_store_round_trips_base_url() {
        let path = temp_store_path();
        let store = ResearchStore {
            auth_token: "research-token".to_string(),
            base_url: Some("http://127.0.0.1:47632".to_string()),
            runs: Vec::new(),
        };

        write_research_store(&path, &store).expect("store should write");
        let loaded = read_research_store(&path).expect("store should read");

        assert_eq!(loaded.base_url, store.base_url);
        let _ = std::fs::remove_file(path);
    }

    fn temp_store_path() -> PathBuf {
        std::env::temp_dir().join(format!("research-store-{}.json", Uuid::new_v4()))
    }
}
