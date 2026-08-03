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

    if result.is_err() || matches!(result, Ok(WebSocketReadResult::Close { .. })) {
        remove_websocket(handle);
    }

    result
}

fn send_websocket_command(handle: u64, command: WebSocketCommand) -> Result<()> {
    let websocket = get_websocket(handle)?;

    if websocket.commands.send(command).is_err() {
        remove_websocket(handle);
        anyhow::bail!("WebSocket is already closed");
    }

    Ok(())
}

pub fn send_websocket_text(handle: u64, text: String) -> Result<()> {
    send_websocket_command(handle, WebSocketCommand::Text(text))
}

pub fn send_websocket_binary(handle: u64, bytes: Vec<u8>) -> Result<()> {
    send_websocket_command(handle, WebSocketCommand::Binary(bytes))
}

pub fn close_websocket(handle: u64, code: Option<u16>, reason: Option<String>) -> Result<()> {
    send_websocket_command(handle, WebSocketCommand::Close { code, reason })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_websocket_when_event_stream_closes() {
        let (commands, _command_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (event_sender, events) = tokio::sync::mpsc::unbounded_channel();
        let handle = insert_websocket(commands, events);

        drop(event_sender);

        let error = read_websocket_message(handle).expect_err("closed event stream should fail");

        assert!(error.to_string().contains("event stream is closed"));
        assert!(
            get_websocket(handle).is_err(),
            "closed WebSocket remained reachable in WEBSOCKET_STORE"
        );
    }

    #[test]
    fn removes_websocket_when_command_stream_closes() {
        let (commands, command_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (_event_sender, events) = tokio::sync::mpsc::unbounded_channel();
        let handle = insert_websocket(commands, events);

        drop(command_receiver);

        let error = send_websocket_text(handle, "test".to_owned())
            .expect_err("closed command stream should fail");

        assert!(error.to_string().contains("already closed"));
        assert!(
            get_websocket(handle).is_err(),
            "closed WebSocket remained reachable in WEBSOCKET_STORE"
        );
    }
}
