use crate::store::runtime::runtime;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Debug)]
struct StoredBody {
    response: wreq::Response,
}

type SharedBody = Arc<tokio::sync::Mutex<StoredBody>>;

static NEXT_BODY_HANDLE: AtomicU64 = AtomicU64::new(1);
static BODY_STORE: OnceLock<Mutex<HashMap<u64, SharedBody>>> = OnceLock::new();

fn body_store() -> &'static Mutex<HashMap<u64, SharedBody>> {
    BODY_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn store_body(response: wreq::Response) -> u64 {
    let handle = NEXT_BODY_HANDLE.fetch_add(1, Ordering::Relaxed);
    body_store().lock().expect("body store poisoned").insert(
        handle,
        Arc::new(tokio::sync::Mutex::new(StoredBody { response })),
    );
    handle
}

fn get_body(handle: u64) -> Result<SharedBody> {
    let store = body_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("body store poisoned"))?;

    store
        .get(&handle)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Unknown body handle: {}", handle))
}

fn remove_body(handle: u64) -> Option<SharedBody> {
    body_store()
        .lock()
        .expect("body store poisoned")
        .remove(&handle)
}

pub fn read_body_chunk(handle: u64, _size: usize) -> Result<(Vec<u8>, bool)> {
    let body = get_body(handle)?;
    let chunk = runtime().block_on(async {
        let mut body = body.lock().await;
        body.response
            .chunk()
            .await
            .context("Failed to read response body chunk")
    })?;

    let Some(chunk) = chunk else {
        remove_body(handle);
        return Ok((Vec::new(), true));
    };

    Ok((chunk.to_vec(), false))
}

pub fn read_body_all(handle: u64) -> Result<Vec<u8>> {
    let Some(body) = remove_body(handle) else {
        return Err(anyhow::anyhow!("Unknown body handle: {}", handle));
    };

    runtime().block_on(async move {
        let mut body = body.lock().await;
        let mut bytes = Vec::new();

        while let Some(chunk) = body
            .response
            .chunk()
            .await
            .context("Failed to read response body chunk")?
        {
            bytes.extend_from_slice(&chunk);
        }

        Ok::<Vec<u8>, anyhow::Error>(bytes)
    })
}

pub fn cancel_body(handle: u64) -> bool {
    remove_body(handle).is_some()
}
