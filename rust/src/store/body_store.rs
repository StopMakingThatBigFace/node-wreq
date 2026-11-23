use anyhow::{Context, Result};
use http_body_util::BodyExt;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};

#[derive(Debug)]
struct StoredBody {
    response: tokio::sync::Mutex<wreq::Response>,
    cancelled: tokio::sync::watch::Sender<bool>,
}

type SharedBody = Arc<StoredBody>;

static NEXT_BODY_HANDLE: AtomicU64 = AtomicU64::new(1);
static BODY_STORE: OnceLock<Mutex<HashMap<u64, SharedBody>>> = OnceLock::new();

fn body_store() -> &'static Mutex<HashMap<u64, SharedBody>> {
    BODY_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn store_body(response: wreq::Response) -> u64 {
    let handle = NEXT_BODY_HANDLE.fetch_add(1, Ordering::Relaxed);
    body_store().lock().expect("body store poisoned").insert(
        handle,
        Arc::new(StoredBody {
            response: tokio::sync::Mutex::new(response),
            cancelled: tokio::sync::watch::channel(false).0,
        }),
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

pub async fn read_body_chunk(handle: u64, _size: usize) -> Result<(Vec<u8>, bool)> {
    let body = get_body(handle)?;
    let mut cancelled = body.cancelled.subscribe();
    let read = async {
        let mut response = body.response.lock().await;
        loop {
            match response.frame().await {
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
    };
    let result = tokio::select! {
        biased;
        _ = cancelled.wait_for(|cancelled| *cancelled) => {
            Err(anyhow::anyhow!("Response body cancelled"))
        }
        result = read => result,
    };
    let chunk = match result {
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

pub async fn read_body_all(handle: u64) -> Result<Vec<u8>> {
    // Keep the handle reachable so cancel_body can interrupt a pending full-body read too.
    let body = get_body(handle)?;
    let mut cancelled = body.cancelled.subscribe();
    let read = async {
        let mut response = body.response.lock().await;
        let mut bytes = Vec::new();

        loop {
            match response.frame().await {
                Some(Ok(frame)) => {
                    if let Ok(data) = frame.into_data() {
                        bytes.extend_from_slice(&data);
                    }
                }
                Some(Err(error)) => {
                    return Err(error).context("Failed to read response body");
                }
                None => return Ok(bytes),
            }
        }
    };
    let result = tokio::select! {
        biased;
        _ = cancelled.wait_for(|cancelled| *cancelled) => {
            Err(anyhow::anyhow!("Response body cancelled"))
        }
        result = read => result,
    };
    remove_body(handle);
    result
}

pub fn cancel_body(handle: u64) -> bool {
    let Some(body) = remove_body(handle) else {
        return false;
    };
    // Removing the entry alone cannot release a response held by an in-flight read.
    body.cancelled.send_replace(true);
    true
}

pub fn forbid_body_recycle(handle: u64) -> Result<bool> {
    let body = get_body(handle)?;
    let body = body
        .response
        .try_lock()
        .map_err(|_| anyhow::anyhow!("Response body is currently being consumed"))?;

    body.forbid_recycle();

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::runtime::runtime;
    use std::future::{poll_fn, Future};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::task::Poll;
    use std::thread;
    use std::time::Duration;

    fn assert_cancels_pending_read(read_all: bool) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test connection");
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .expect("set test socket timeout");
            let mut request = Vec::new();
            let mut byte = [0_u8];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).expect("read test request");
                request.push(byte[0]);
            }
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n")
                .expect("write partial response");
            stream.flush().expect("flush partial response");
            match stream.read(&mut byte) {
                Ok(0) => true,
                Err(error) => matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                ),
                _ => false,
            }
        });

        let (cancelled, result, handle) = runtime().block_on(async {
            let response = wreq::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("build test client")
                .get(format!("http://{address}/"))
                .send()
                .await
                .expect("receive response headers");
            let handle = store_body(response);
            if !read_all {
                let (chunk, done) = read_body_chunk(handle, 65_536)
                    .await
                    .expect("read first chunk");
                assert_eq!(chunk, b"x");
                assert!(!done);
            }

            let mut read = Box::pin(async {
                if read_all {
                    read_body_all(handle).await.map(|_| ())
                } else {
                    read_body_chunk(handle, 65_536).await.map(|_| ())
                }
            });
            // Poll the real read into its wait before cancelling; no timing-based sleep is needed.
            poll_fn(|cx| {
                assert!(read.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;

            let cancelled = cancel_body(handle);
            let result = tokio::time::timeout(Duration::from_secs(1), read).await;
            (cancelled, result, handle)
        });

        let closed = server.join().expect("join test server");
        assert!(cancelled, "pending read was unreachable by cancel_body");
        let error = result
            .expect("pending read was not interrupted")
            .expect_err("read succeeded");
        assert_eq!(error.to_string(), "Response body cancelled");
        assert!(get_body(handle).is_err(), "cancelled body remained stored");
        assert!(
            !cancel_body(handle),
            "repeated cancellation should be a no-op"
        );
        assert!(closed, "cancelled response kept its connection open");
    }

    #[test]
    fn cancels_pending_chunk_read() {
        assert_cancels_pending_read(false);
    }

    #[test]
    fn cancels_pending_full_body_read() {
        assert_cancels_pending_read(true);
    }

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
            match runtime().block_on(read_body_chunk(handle, 65_536)) {
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

    #[test]
    fn reads_complete_body_and_removes_handle() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test connection");
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request).expect("read test request");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\nhello world")
                .expect("write response");
            stream.flush().expect("flush response");
        });

        let response = runtime()
            .block_on(wreq::get(format!("http://{address}/")).send())
            .expect("receive response headers");
        let handle = store_body(response);
        let body = runtime()
            .block_on(read_body_all(handle))
            .expect("read response body");

        server.join().expect("join test server");
        assert_eq!(body, b"hello world");
        assert!(
            get_body(handle).is_err(),
            "fully read response remained reachable in BODY_STORE"
        );
    }
}
