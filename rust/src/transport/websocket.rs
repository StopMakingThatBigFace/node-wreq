use crate::store::runtime::runtime;
use crate::store::websocket_store::{insert_websocket, WebSocketCommand};
use crate::transport::client::websocket_client;
use crate::transport::headers::build_orig_header_map;
use crate::transport::types::{WebSocketConnectOptions, WebSocketConnection, WebSocketReadResult};
use anyhow::{Context, Result};
use wreq::ws::message::{CloseCode, CloseFrame, Message};
use wreq::ws::WebSocket;
use wreq::Version;

pub fn connect_websocket(options: WebSocketConnectOptions) -> Result<WebSocketConnection> {
    runtime().block_on(make_websocket(options))
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

async fn make_websocket(options: WebSocketConnectOptions) -> Result<WebSocketConnection> {
    let client = websocket_client(&options).await?;
    let WebSocketConnectOptions {
        client_id: _,
        client_cache_key: _,
        url,
        emulation: _,
        headers,
        orig_headers,
        proxy: _,
        disable_system_proxy: _,
        dns: _,
        timeout: _,
        pool_idle_timeout: _,
        pool_max_idle_per_host: _,
        pool_max_size: _,
        tls_session_cache_capacity: _,
        disable_default_headers,
        protocols,
        force_http2,
        http_version,
        read_buffer_size,
        write_buffer_size,
        max_write_buffer_size,
        accept_unmasked_frames,
        max_frame_size,
        max_message_size,
        local_bind: _,
        tls_identity: _,
        certificate_authority: _,
        tls_debug: _,
        tls_danger: _,
    } = options;

    let mut request = client.websocket(&url);
    let orig_headers = build_orig_header_map(&orig_headers);
    for (key, value) in &headers {
        request = request.header(key, value);
    }

    if !orig_headers.is_empty() {
        request = request.orig_headers(orig_headers);
    }

    request = request.default_headers(!disable_default_headers);

    if let Some(version) = http_version {
        request = request.version(version);
    } else if force_http2 {
        request = request.version(Version::HTTP_2);
    }

    if let Some(read_buffer_size) = read_buffer_size {
        request = request.read_buffer_size(read_buffer_size);
    }

    if let Some(write_buffer_size) = write_buffer_size {
        request = request.write_buffer_size(write_buffer_size);
    }

    if let Some(max_write_buffer_size) = max_write_buffer_size {
        request = request.max_write_buffer_size(max_write_buffer_size);
    }

    if let Some(accept_unmasked_frames) = accept_unmasked_frames {
        request = request.accept_unmasked_frames(accept_unmasked_frames);
    }

    if let Some(max_frame_size) = max_frame_size {
        request = request.max_frame_size(max_frame_size);
    }

    if let Some(max_message_size) = max_message_size {
        request = request.max_message_size(max_message_size);
    }

    if !protocols.is_empty() {
        request = request.protocols(protocols.iter().cloned());
    }

    let response = request
        .send()
        .await
        .with_context(|| format!("WS {}", url))?;

    let extensions = response
        .headers()
        .get("sec-websocket-extensions")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let websocket = response
        .into_websocket()
        .await
        .with_context(|| format!("WS upgrade {}", url))?;

    let protocol = websocket
        .protocol()
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let (command_tx, command_rx) = tokio::sync::mpsc::unbounded_channel();
    let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
    runtime().spawn(run_websocket_task(websocket, command_rx, event_tx));
    let handle = insert_websocket(command_tx, event_rx);

    Ok(WebSocketConnection {
        handle,
        protocol,
        extensions,
        url,
    })
}
