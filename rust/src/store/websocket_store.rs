use crate::transport::types::WebSocketReadResult;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Debug)]
pub(crate) enum WebSocketCommand {
    Text(String),
    Binary(Vec<u8>),
    Close {
        code: Option<u16>,
        reason: Option<String>,
    },
}

#[derive(Debug)]
pub(crate) struct StoredWebSocket {
    pub commands: tokio::sync::mpsc::UnboundedSender<WebSocketCommand>,
    pub events: tokio::sync::Mutex<tokio::sync::mpsc::UnboundedReceiver<WebSocketReadResult>>,
}

pub(crate) type SharedWebSocket = Arc<StoredWebSocket>;

static NEXT_WEBSOCKET_HANDLE: AtomicU64 = AtomicU64::new(1);
static WEBSOCKET_STORE: OnceLock<Mutex<HashMap<u64, SharedWebSocket>>> = OnceLock::new();

fn websocket_store() -> &'static Mutex<HashMap<u64, SharedWebSocket>> {
    WEBSOCKET_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn insert_websocket(
    commands: tokio::sync::mpsc::UnboundedSender<WebSocketCommand>,
    events: tokio::sync::mpsc::UnboundedReceiver<WebSocketReadResult>,
) -> u64 {
    let handle = NEXT_WEBSOCKET_HANDLE.fetch_add(1, Ordering::Relaxed);

    websocket_store()
        .lock()
        .expect("websocket store poisoned")
        .insert(
            handle,
            Arc::new(StoredWebSocket {
                commands,
                events: tokio::sync::Mutex::new(events),
            }),
        );

    handle
}

fn get_websocket(handle: u64) -> Result<SharedWebSocket> {
    let store = websocket_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("websocket store poisoned"))?;

    store
        .get(&handle)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Unknown websocket handle: {}", handle))
}

pub(crate) fn remove_websocket(handle: u64) {
    websocket_store()
        .lock()
        .expect("websocket store poisoned")
        .remove(&handle);
}

pub fn read_websocket_message(handle: u64) -> Result<WebSocketReadResult> {
    let websocket = get_websocket(handle)?;

    let result = crate::store::runtime::runtime().block_on(async {
        let mut events = websocket.events.lock().await;
        events
            .recv()
            .await
            .ok_or_else(|| anyhow::anyhow!("WebSocket event stream is closed"))
    });

    if matches!(result, Ok(WebSocketReadResult::Close { .. })) {
        remove_websocket(handle);
    }

    result
}

pub fn send_websocket_text(handle: u64, text: String) -> Result<()> {
    let websocket = get_websocket(handle)?;
    websocket
        .commands
        .send(WebSocketCommand::Text(text))
        .map_err(|_| anyhow::anyhow!("WebSocket is already closed"))
}

pub fn send_websocket_binary(handle: u64, bytes: Vec<u8>) -> Result<()> {
    let websocket = get_websocket(handle)?;
    websocket
        .commands
        .send(WebSocketCommand::Binary(bytes))
        .map_err(|_| anyhow::anyhow!("WebSocket is already closed"))
}

pub fn close_websocket(handle: u64, code: Option<u16>, reason: Option<String>) -> Result<()> {
    let websocket = get_websocket(handle)?;
    websocket
        .commands
        .send(WebSocketCommand::Close { code, reason })
        .map_err(|_| anyhow::anyhow!("WebSocket is already closed"))
}
