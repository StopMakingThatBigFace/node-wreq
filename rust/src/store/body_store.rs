use crate::store::runtime::runtime;
use anyhow::{Context, Result};
use http_body_util::BodyExt;
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
    let chunk = match runtime().block_on(async {
        let mut body = body.lock().await;
        loop {
            match body.response.frame().await {
                Some(Ok(frame)) => {
                    if let Ok(data) = frame.into_data() {
                        break Ok(Some(data));
                    }
                }
                Some(Err(error)) => break Err(error),
                None => break Ok(None),
            }
        }
        .context("Failed to read response body chunk")
    }) {
        Ok(chunk) => chunk,
        Err(error) => {
            // The body errored, so the connection is unusable — drop the stored body to release it and its
            // socket instead of leaking the entry in BODY_STORE (mirrors the done-path cleanup below).
            remove_body(handle);
            return Err(error);
        }
    };

    let Some(chunk) = chunk else {
        remove_body(handle);
        return Ok((Vec::new(), true));
    };

    Ok((chunk.to_vec(), false))
}

pub fn cancel_body(handle: u64) -> bool {
    remove_body(handle).is_some()
}

pub fn forbid_body_recycle(handle: u64) -> Result<bool> {
    let body = get_body(handle)?;
    let body = body
        .try_lock()
        .map_err(|_| anyhow::anyhow!("Response body is currently being consumed"))?;

    body.response.forbid_recycle();

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn removes_body_after_a_truncated_response_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test connection");
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request).expect("read test request");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 1024\r\nConnection: close\r\n\r\npartial",
                )
                .expect("write truncated response");
            stream.flush().expect("flush truncated response");
            thread::sleep(std::time::Duration::from_millis(50));
        });

        let response = runtime()
            .block_on(wreq::get(format!("http://{address}/")).send())
            .expect("receive response headers");
        let handle = store_body(response);
        let mut read_error = None;

        for _ in 0..3 {
            match read_body_chunk(handle, 65_536) {
                Ok((_, done)) => assert!(!done, "truncated response unexpectedly completed"),
                Err(error) => {
                    read_error = Some(error);
                    break;
                }
            }
        }

        server.join().expect("join test server");
        assert!(
            read_error.is_some(),
            "truncated response did not report an error"
        );
        assert!(
            get_body(handle).is_err(),
            "failed response remained reachable in BODY_STORE"
        );
    }
}
