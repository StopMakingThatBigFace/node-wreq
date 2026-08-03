use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};

static NEXT_WEBSOCKET_CONNECT_HANDLE: AtomicU64 = AtomicU64::new(1);
static WEBSOCKET_CONNECT_STORE: OnceLock<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<()>>>> =
    OnceLock::new();

fn websocket_connect_store() -> &'static Mutex<HashMap<u64, tokio::sync::oneshot::Sender<()>>> {
    WEBSOCKET_CONNECT_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn insert_websocket_connect(cancel: tokio::sync::oneshot::Sender<()>) -> u64 {
    let handle = NEXT_WEBSOCKET_CONNECT_HANDLE.fetch_add(1, Ordering::Relaxed);

    websocket_connect_store()
        .lock()
        .expect("websocket connect store poisoned")
        .insert(handle, cancel);

    handle
}

pub fn remove_websocket_connect(handle: u64) {
    websocket_connect_store()
        .lock()
        .expect("websocket connect store poisoned")
        .remove(&handle);
}

pub fn cancel_websocket_connect(handle: u64) -> bool {
    let cancel = websocket_connect_store()
        .lock()
        .expect("websocket connect store poisoned")
        .remove(&handle);

    cancel
        .map(|cancel| cancel.send(()).is_ok())
        .unwrap_or(false)
}
