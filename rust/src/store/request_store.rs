use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};

static NEXT_REQUEST_HANDLE: AtomicU64 = AtomicU64::new(1);
static REQUEST_STORE: OnceLock<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<()>>>> =
    OnceLock::new();

fn request_store() -> &'static Mutex<HashMap<u64, tokio::sync::oneshot::Sender<()>>> {
    REQUEST_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn insert_request(cancel: tokio::sync::oneshot::Sender<()>) -> u64 {
    let handle = NEXT_REQUEST_HANDLE.fetch_add(1, Ordering::Relaxed);

    request_store()
        .lock()
        .expect("request store poisoned")
        .insert(handle, cancel);

    handle
}

pub fn remove_request(handle: u64) {
    request_store()
        .lock()
        .expect("request store poisoned")
        .remove(&handle);
}

pub fn cancel_request(handle: u64) -> bool {
    let cancel = request_store()
        .lock()
        .expect("request store poisoned")
        .remove(&handle);

    cancel
        .map(|cancel| cancel.send(()).is_ok())
        .unwrap_or(false)
}
