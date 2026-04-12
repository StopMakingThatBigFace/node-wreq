use crate::store::runtime::runtime;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};

#[derive(Debug)]
struct StoredBody {
    response: wreq::Response,
}

static NEXT_BODY_HANDLE: AtomicU64 = AtomicU64::new(1);
static BODY_STORE: OnceLock<Mutex<HashMap<u64, StoredBody>>> = OnceLock::new();

fn body_store() -> &'static Mutex<HashMap<u64, StoredBody>> {
    BODY_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn store_body(response: wreq::Response) -> u64 {
    let handle = NEXT_BODY_HANDLE.fetch_add(1, Ordering::Relaxed);
    body_store()
        .lock()
        .expect("body store poisoned")
        .insert(handle, StoredBody { response });
    handle
}

pub fn read_body_chunk(handle: u64, _size: usize) -> Result<(Vec<u8>, bool)> {
    let mut store = body_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("body store poisoned"))?;
    let Some(body) = store.get_mut(&handle) else {
        return Err(anyhow::anyhow!("Unknown body handle: {}", handle));
    };

    let chunk = runtime()
        .block_on(body.response.chunk())
        .context("Failed to read response body chunk")?;

    let Some(chunk) = chunk else {
        store.remove(&handle);
        return Ok((Vec::new(), true));
    };

    Ok((chunk.to_vec(), false))
}

pub fn read_body_all(handle: u64) -> Result<Vec<u8>> {
    let mut store = body_store()
        .lock()
        .map_err(|_| anyhow::anyhow!("body store poisoned"))?;
    let Some(body) = store.remove(&handle) else {
        return Err(anyhow::anyhow!("Unknown body handle: {}", handle));
    };

    let mut bytes = Vec::new();
    let mut response = body.response;

    runtime().block_on(async {
        while let Some(chunk) = response
            .chunk()
            .await
            .context("Failed to read response body chunk")?
        {
            bytes.extend_from_slice(&chunk);
        }

        Ok::<(), anyhow::Error>(())
    })?;

    Ok(bytes)
}

pub fn cancel_body(handle: u64) -> bool {
    body_store()
        .lock()
        .expect("body store poisoned")
        .remove(&handle)
        .is_some()
}
