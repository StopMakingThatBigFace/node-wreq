use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;
use wreq::redirect;
use wreq::ws::WebSocket;
use wreq::ws::message::{CloseCode, CloseFrame, Message};
use wreq_util::Emulation;

#[derive(Debug, Clone)]
pub struct RequestOptions {
    pub url: String,
    pub emulation: Emulation,
    pub headers: HashMap<String, String>,
    pub method: String,
    pub body: Option<String>,
    pub proxy: Option<String>,
    pub timeout: u64,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body_handle: u64,
    pub cookies: HashMap<String, String>,
    pub set_cookies: Vec<String>,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct WebSocketConnectOptions {
    pub url: String,
    pub emulation: Emulation,
    pub headers: HashMap<String, String>,
    pub proxy: Option<String>,
    pub timeout: u64,
    pub protocols: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct WebSocketConnection {
    pub handle: u64,
    pub protocol: Option<String>,
    pub extensions: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone)]
pub enum WebSocketReadResult {
    Text(String),
    Binary(Vec<u8>),
    Close {
        code: u16,
        reason: String,
        was_clean: bool,
    },
}

#[derive(Debug)]
enum WebSocketCommand {
    Text(String),
    Binary(Vec<u8>),
    Close {
        code: Option<u16>,
        reason: Option<String>,
    },
}

#[derive(Debug)]
struct StoredBody {
    response: wreq::Response,
}

#[derive(Debug)]
struct StoredWebSocket {
    commands: tokio::sync::mpsc::UnboundedSender<WebSocketCommand>,
    events: tokio::sync::Mutex<tokio::sync::mpsc::UnboundedReceiver<WebSocketReadResult>>,
}

type SharedWebSocket = Arc<StoredWebSocket>;

static NEXT_BODY_HANDLE: AtomicU64 = AtomicU64::new(1);
static NEXT_WEBSOCKET_HANDLE: AtomicU64 = AtomicU64::new(1);
static BODY_STORE: OnceLock<Mutex<HashMap<u64, StoredBody>>> = OnceLock::new();
static WEBSOCKET_STORE: OnceLock<Mutex<HashMap<u64, SharedWebSocket>>> = OnceLock::new();
static TOKIO_RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn body_store() -> &'static Mutex<HashMap<u64, StoredBody>> {
    BODY_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn websocket_store() -> &'static Mutex<HashMap<u64, SharedWebSocket>> {
    WEBSOCKET_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn runtime() -> &'static tokio::runtime::Runtime {
    TOKIO_RUNTIME.get_or_init(|| {
        tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime")
    })
}

pub fn execute_request(options: RequestOptions) -> Result<Response> {
    runtime().block_on(make_request(options))
}

pub fn connect_websocket(options: WebSocketConnectOptions) -> Result<WebSocketConnection> {
    runtime().block_on(make_websocket(options))
}

fn store_body(response: wreq::Response) -> u64 {
    let handle = NEXT_BODY_HANDLE.fetch_add(1, Ordering::Relaxed);
    body_store()
        .lock()
        .expect("body store poisoned")
        .insert(handle, StoredBody { response });
    handle
}

fn store_websocket(websocket: WebSocket) -> u64 {
    let handle = NEXT_WEBSOCKET_HANDLE.fetch_add(1, Ordering::Relaxed);
    let (command_tx, command_rx) = tokio::sync::mpsc::unbounded_channel();
    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();

    runtime().spawn(run_websocket_task(websocket, command_rx, event_tx));

    websocket_store()
        .lock()
        .expect("websocket store poisoned")
        .insert(
            handle,
            Arc::new(StoredWebSocket {
                commands: command_tx,
                events: tokio::sync::Mutex::new(event_rx),
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

pub fn read_websocket_message(handle: u64) -> Result<WebSocketReadResult> {
    let websocket = get_websocket(handle)?;

    let result = runtime().block_on(async {
        let mut events = websocket.events.lock().await;
        events
            .recv()
            .await
            .ok_or_else(|| anyhow::anyhow!("WebSocket event stream is closed"))
    });

    if matches!(result, Ok(WebSocketReadResult::Close { .. })) {
        websocket_store()
            .lock()
            .expect("websocket store poisoned")
            .remove(&handle);
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

fn parse_cookie_pair(set_cookie: &str) -> Option<(String, String)> {
    let pair = set_cookie.split(';').next()?.trim();
    let (name, value) = pair.split_once('=')?;

    Some((name.to_string(), value.to_string()))
}

async fn run_websocket_task(
    mut websocket: WebSocket,
    mut commands: tokio::sync::mpsc::UnboundedReceiver<WebSocketCommand>,
    events: tokio::sync::mpsc::UnboundedSender<WebSocketReadResult>,
) {
    let mut close_requested = false;
    let mut requested_close_code = 1000;
    let mut requested_close_reason = String::new();

    loop {
        tokio::select! {
            command = commands.recv() => {
                match command {
                    Some(WebSocketCommand::Text(text)) => {
                        if websocket.send(Message::Text(text.into())).await.is_err() {
                            let _ = events.send(WebSocketReadResult::Close {
                                code: 1006,
                                reason: String::new(),
                                was_clean: false,
                            });
                            break;
                        }
                    }
                    Some(WebSocketCommand::Binary(bytes)) => {
                        if websocket.send(Message::Binary(bytes.into())).await.is_err() {
                            let _ = events.send(WebSocketReadResult::Close {
                                code: 1006,
                                reason: String::new(),
                                was_clean: false,
                            });
                            break;
                        }
                    }
                    Some(WebSocketCommand::Close { code, reason }) => {
                        close_requested = true;
                        requested_close_code = code.unwrap_or(1000);
                        requested_close_reason = reason.unwrap_or_default();

                        let frame = Message::Close(Some(CloseFrame {
                            code: CloseCode::from(requested_close_code),
                            reason: requested_close_reason.clone().into(),
                        }));

                        if websocket.send(frame).await.is_err() {
                            let _ = events.send(WebSocketReadResult::Close {
                                code: 1006,
                                reason: String::new(),
                                was_clean: false,
                            });
                            break;
                        }
                    }
                    None => {
                        break;
                    }
                }
            }
            message = websocket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if events.send(WebSocketReadResult::Text(text.to_string())).is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if events.send(WebSocketReadResult::Binary(bytes.to_vec())).is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = match frame {
                            Some(frame) => (u16::from(frame.code), frame.reason.to_string()),
                            None => {
                                if close_requested {
                                    (requested_close_code, requested_close_reason.clone())
                                } else {
                                    (1005, String::new())
                                }
                            }
                        };

                        let _ = events.send(WebSocketReadResult::Close {
                            code,
                            reason,
                            was_clean: true,
                        });
                        break;
                    }
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                    Some(Err(_)) => {
                        let _ = events.send(WebSocketReadResult::Close {
                            code: 1006,
                            reason: String::new(),
                            was_clean: false,
                        });
                        break;
                    }
                    None => {
                        let _ = events.send(WebSocketReadResult::Close {
                            code: if close_requested {
                                requested_close_code
                            } else {
                                1006
                            },
                            reason: if close_requested {
                                requested_close_reason.clone()
                            } else {
                                String::new()
                            },
                            was_clean: close_requested,
                        });
                        break;
                    }
                }
            }
        }
    }
}

pub async fn make_request(options: RequestOptions) -> Result<Response> {
    let mut client_builder = wreq::Client::builder()
        .emulation(options.emulation)
        .cookie_store(true);

    if let Some(proxy_url) = &options.proxy {
        let proxy = wreq::Proxy::all(proxy_url).context("Failed to create proxy")?;
        client_builder = client_builder.proxy(proxy);
    }

    let client = client_builder.build().context("Failed to build HTTP client")?;

    let method = if options.method.is_empty() {
        "GET"
    } else {
        &options.method
    };

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&options.url),
        "POST" => client.post(&options.url),
        "PUT" => client.put(&options.url),
        "DELETE" => client.delete(&options.url),
        "PATCH" => client.patch(&options.url),
        "HEAD" => client.head(&options.url),
        _ => return Err(anyhow::anyhow!("Unsupported HTTP method: {}", method)),
    };

    for (key, value) in &options.headers {
        request = request.header(key, value);
    }

    if let Some(body) = options.body {
        request = request.body(body);
    }

    request = request.timeout(Duration::from_millis(options.timeout));
    request = request.redirect(redirect::Policy::none());

    let response = request
        .send()
        .await
        .with_context(|| format!("{} {}", method, options.url))?;

    let status = response.status().as_u16();
    let final_url = response.uri().to_string();

    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            response_headers.insert(key.to_string(), value_str.to_string());
        }
    }

    let mut cookies = HashMap::new();
    let mut set_cookies = Vec::new();
    for cookie_header in response.headers().get_all("set-cookie") {
        if let Ok(cookie_str) = cookie_header.to_str() {
            set_cookies.push(cookie_str.to_string());

            if let Some((key, value)) = parse_cookie_pair(cookie_str) {
                cookies.insert(key, value);
            }
        }
    }

    let body_handle = store_body(response);

    Ok(Response {
        status,
        headers: response_headers,
        body_handle,
        cookies,
        set_cookies,
        url: final_url,
    })
}

async fn make_websocket(options: WebSocketConnectOptions) -> Result<WebSocketConnection> {
    let mut client_builder = wreq::Client::builder()
        .emulation(options.emulation)
        .cookie_store(true)
        .timeout(Duration::from_millis(options.timeout));

    if let Some(proxy_url) = &options.proxy {
        let proxy = wreq::Proxy::all(proxy_url).context("Failed to create proxy")?;
        client_builder = client_builder.proxy(proxy);
    }

    let client = client_builder
        .build()
        .context("Failed to build WebSocket client")?;

    let mut request = client.websocket(&options.url);
    for (key, value) in &options.headers {
        request = request.header(key, value);
    }

    if !options.protocols.is_empty() {
        request = request.protocols(options.protocols.iter().cloned());
    }

    let response = request
        .send()
        .await
        .with_context(|| format!("WS {}", options.url))?;

    let extensions = response
        .headers()
        .get("sec-websocket-extensions")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let websocket = response
        .into_websocket()
        .await
        .with_context(|| format!("WS upgrade {}", options.url))?;

    let protocol = websocket
        .protocol()
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let handle = store_websocket(websocket);

    Ok(WebSocketConnection {
        handle,
        protocol,
        extensions,
        url: options.url,
    })
}
