use crate::emulation::resolve_emulation;
use crate::napi::profiles::parse_browser_emulation;
use crate::store::upload_store::take_upload_receiver;
use crate::transport::types::{
    CertificateAuthorityOptions, ConnectionGroup, DnsOptions, LocalBindOptions,
    MultipartBodyOptions, MultipartPartOptions, PoolIdleTimeout, RequestBody, RequestOptions,
    Response, TlsDangerOptions, TlsDebugOptions, TlsIdentityOptions, TlsKeylogOptions,
    WebSocketConnectOptions, WebSocketConnection,
};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use neon::types::JsBuffer;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

fn js_value_to_timeout_ms(cx: &mut FunctionContext, value: Handle<JsValue>) -> NeonResult<u64> {
    let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

    if !value.is_finite() || value < 0.0 {
        return cx.throw_type_error("timeout must be a finite non-negative number");
    }

    Ok(if value == 0.0 { 0 } else { value.ceil() as u64 })
}

fn js_value_to_positive_usize(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
    name: &str,
) -> NeonResult<usize> {
    let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

    if !value.is_finite() || value <= 0.0 {
        return cx.throw_type_error(format!("{name} must be a finite positive number"));
    }

    if value > usize::MAX as f64 {
        return cx.throw_type_error(format!("{name} exceeds the supported range"));
    }

    Ok(value.ceil() as usize)
}

fn js_value_to_non_negative_usize(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
    name: &str,
) -> NeonResult<usize> {
    let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 {
        return cx.throw_type_error(format!("{name} must be a finite non-negative integer"));
    }
    if value > usize::MAX as f64 {
        return cx.throw_type_error(format!("{name} exceeds the supported range"));
    }

    Ok(value as usize)
}

fn js_object_to_client_identity(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<(Option<u64>, Option<String>)> {
    let client_id = obj
        .get_opt(cx, "clientId")?
        .map(|value: Handle<JsValue>| {
            let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

            if !value.is_finite()
                || value.fract() != 0.0
                || !(0.0..=9_007_199_254_740_991.0).contains(&value)
            {
                return cx.throw_type_error("clientId must be a non-negative safe integer");
            }

            Ok(value as u64)
        })
        .transpose()?;
    let cache_key = obj
        .get_opt(cx, "clientCacheKey")?
        .map(|value: Handle<JsValue>| value.downcast::<JsString, _>(cx).or_throw(cx))
        .transpose()?
        .map(|value| value.value(cx));

    if client_id.is_some() != cache_key.is_some() {
        return cx.throw_type_error("clientId and clientCacheKey must be provided together");
    }

    Ok((client_id, cache_key))
}

fn js_object_to_pool_idle_timeout(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<PoolIdleTimeout>> {
    let Some(value) = obj.get_opt::<JsValue, _, _>(cx, "poolIdleTimeout")? else {
        return Ok(None);
    };

    if let Ok(value) = value.downcast::<JsBoolean, _>(cx) {
        if value.value(cx) {
            return cx.throw_type_error("poolIdleTimeout only accepts false or milliseconds");
        }

        return Ok(Some(PoolIdleTimeout::Disabled));
    }

    Ok(Some(PoolIdleTimeout::Millis(js_value_to_timeout_ms(
        cx, value,
    )?)))
}

fn js_object_to_connection_group(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<ConnectionGroup>> {
    let Some(value) = obj.get_opt::<JsValue, _, _>(cx, "connectionGroup")? else {
        return Ok(None);
    };

    if let Ok(value) = value.downcast::<JsString, _>(cx) {
        let value = value.value(cx);

        if value.is_empty() {
            return cx.throw_type_error("connectionGroup must not be empty");
        }

        return Ok(Some(ConnectionGroup::Name(value)));
    }

    let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

    if !value.is_finite()
        || value.fract() != 0.0
        || !(0.0..=9_007_199_254_740_991.0).contains(&value)
    {
        return cx
            .throw_type_error("connectionGroup must be a string or non-negative safe integer");
    }

    Ok(Some(ConnectionGroup::Number(value as u64)))
}

fn js_value_to_non_negative_timeout_ms(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
    name: &str,
) -> NeonResult<Option<u64>> {
    obj.get_opt(cx, name)?
        .map(|v| js_value_to_timeout_ms(cx, v))
        .transpose()
}

fn js_object_to_local_bind_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<LocalBindOptions>> {
    let address = obj
        .get_opt(cx, "localAddress")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .map(|value| {
            value.parse::<IpAddr>().or_else(|_| {
                cx.throw_type_error(format!("localAddress must be a valid IP address: {value}"))
            })
        })
        .transpose()?;

    let (ipv4, ipv6) = if let Some(local_addresses) = obj
        .get_opt(cx, "localAddresses")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsObject, _>(cx).ok())
    {
        let ipv4 = local_addresses
            .get_opt(cx, "ipv4")?
            .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
            .map(|v| v.value(cx))
            .map(|value| {
                value.parse::<Ipv4Addr>().or_else(|_| {
                    cx.throw_type_error(format!(
                        "localAddresses.ipv4 must be a valid IPv4 address: {value}"
                    ))
                })
            })
            .transpose()?;
        let ipv6 = local_addresses
            .get_opt(cx, "ipv6")?
            .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
            .map(|v| v.value(cx))
            .map(|value| {
                value.parse::<Ipv6Addr>().or_else(|_| {
                    cx.throw_type_error(format!(
                        "localAddresses.ipv6 must be a valid IPv6 address: {value}"
                    ))
                })
            })
            .transpose()?;

        (ipv4, ipv6)
    } else {
        (None, None)
    };

    let interface = obj
        .get_opt(cx, "interface")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .map(|value| {
            let trimmed = value.trim().to_string();

            if trimmed.is_empty() {
                return cx.throw_type_error("interface must be a non-empty string");
            }

            Ok(trimmed)
        })
        .transpose()?;

    if address.is_none() && ipv4.is_none() && ipv6.is_none() && interface.is_none() {
        return Ok(None);
    }

    Ok(Some(LocalBindOptions {
        address,
        ipv4,
        ipv6,
        interface,
    }))
}

fn js_object_to_tls_debug_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<TlsDebugOptions>> {
    let Some(debug_obj) = obj
        .get_opt(cx, "tlsDebug")?
        .map(|value: Handle<JsValue>| value.downcast::<JsObject, _>(cx).or_throw(cx))
        .transpose()?
    else {
        return Ok(None);
    };

    let peer_certificates = debug_obj
        .get_opt(cx, "peerCertificates")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);

    let keylog_from_env = debug_obj
        .get_opt(cx, "keylogFromEnv")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);
    let keylog_path = debug_obj
        .get_opt(cx, "keylogPath")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    let keylog = if let Some(path) = keylog_path {
        let path = path.trim().to_string();

        if path.is_empty() {
            return cx.throw_type_error("tlsDebug.keylog.path must be a non-empty string");
        }

        Some(TlsKeylogOptions::File { path })
    } else if keylog_from_env {
        Some(TlsKeylogOptions::FromEnv)
    } else {
        match debug_obj.get_opt::<JsValue, _, _>(cx, "keylog")? {
            Some(value) if value.is_a::<JsBoolean, _>(cx) => {
                let enabled = value.downcast::<JsBoolean, _>(cx).or_throw(cx)?.value(cx);

                if enabled {
                    Some(TlsKeylogOptions::FromEnv)
                } else {
                    None
                }
            }
            Some(value) if value.is_a::<JsObject, _>(cx) => {
                let value = value.downcast::<JsObject, _>(cx).or_throw(cx)?;
                let Some(path) = value
                    .get_opt(cx, "path")?
                    .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
                    .map(|v| v.value(cx))
                else {
                    return cx.throw_type_error("tlsDebug.keylog.path must be a non-empty string");
                };

                let path = path.trim().to_string();

                if path.is_empty() {
                    return cx.throw_type_error("tlsDebug.keylog.path must be a non-empty string");
                }

                Some(TlsKeylogOptions::File { path })
            }
            Some(_) => {
                return cx
                    .throw_type_error("tlsDebug.keylog must be true or an object with a path");
            }
            None => None,
        }
    };

    if !peer_certificates && keylog.is_none() {
        return Ok(None);
    }

    Ok(Some(TlsDebugOptions {
        peer_certificates,
        keylog,
    }))
}

fn js_object_to_tls_danger_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<TlsDangerOptions>> {
    let Some(danger_obj) = obj
        .get_opt(cx, "tlsDanger")?
        .map(|value: Handle<JsValue>| value.downcast::<JsObject, _>(cx).or_throw(cx))
        .transpose()?
    else {
        return Ok(None);
    };

    let cert_verification = danger_obj
        .get_opt(cx, "certVerification")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx));
    let verify_hostname = danger_obj
        .get_opt(cx, "verifyHostname")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx));
    let sni = danger_obj
        .get_opt(cx, "sni")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx));

    if cert_verification.is_none() && verify_hostname.is_none() && sni.is_none() {
        return Ok(None);
    }

    Ok(Some(TlsDangerOptions {
        cert_verification,
        verify_hostname,
        sni,
    }))
}

pub(crate) fn js_value_to_string_array(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<Vec<String>> {
    let array = value.downcast::<JsArray, _>(cx).or_throw(cx)?;
    let mut strings = Vec::with_capacity(array.len(cx) as usize);

    for item in array.to_vec(cx)? {
        let string = item.downcast::<JsString, _>(cx).or_throw(cx)?;
        strings.push(string.value(cx));
    }

    Ok(strings)
}

pub(crate) fn js_value_to_header_tuples(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<Vec<(String, String)>> {
    let array = value.downcast::<JsArray, _>(cx).or_throw(cx)?;
    let mut tuples = Vec::with_capacity(array.len(cx) as usize);

    for item in array.to_vec(cx)? {
        let tuple = item.downcast::<JsArray, _>(cx).or_throw(cx)?;
        if tuple.len(cx) != 2 {
            return cx.throw_type_error("Header tuple entries must contain exactly 2 items");
        }

        let name = tuple.get::<JsString, _, _>(cx, 0)?.value(cx);
        let value = tuple.get::<JsString, _, _>(cx, 1)?.value(cx);
        tuples.push((name, value));
    }

    Ok(tuples)
}

fn js_object_to_emulation(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<wreq::Emulation> {
    let browser = obj
        .get_opt(cx, "browser")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "chrome_149".to_string());
    let mode = obj
        .get_opt(cx, "browserMode")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "fixed".to_string());
    let platform = obj
        .get_opt(cx, "browserPlatform")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));
    let http2 = obj
        .get_opt(cx, "browserHttp2")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx));
    let headers = obj
        .get_opt(cx, "browserHeaders")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx));
    let emulation_json = obj
        .get_opt(cx, "emulationJson")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    resolve_emulation(
        parse_browser_emulation(&browser),
        &mode,
        platform.as_deref(),
        http2,
        headers,
        emulation_json.as_deref(),
    )
    .or_else(|error| cx.throw_error(format!("{:#}", error)))
}

struct MultipartStreamDescriptor {
    name: String,
    file_name: String,
    mime_type: String,
    length: u64,
    handle: u64,
}

enum MultipartPartDescriptor {
    Text { name: String, value: String },
    Stream(MultipartStreamDescriptor),
}

fn js_value_to_safe_u64(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
    name: &str,
) -> NeonResult<u64> {
    let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

    if !value.is_finite()
        || value.fract() != 0.0
        || !(0.0..=9_007_199_254_740_991.0).contains(&value)
    {
        return cx.throw_type_error(format!("{name} must be a non-negative safe integer"));
    }

    Ok(value as u64)
}

fn js_object_to_multipart_body(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<MultipartBodyOptions>> {
    let Some(value) = obj.get_opt::<JsValue, _, _>(cx, "multipart")? else {
        return Ok(None);
    };
    let multipart = value.downcast::<JsObject, _>(cx).or_throw(cx)?;
    let boundary = multipart.get::<JsString, _, _>(cx, "boundary")?.value(cx);
    let parts = multipart.get::<JsArray, _, _>(cx, "parts")?;
    let mut descriptors = Vec::with_capacity(parts.len(cx) as usize);

    for (index, value) in parts.to_vec(cx)?.into_iter().enumerate() {
        let part = value.downcast::<JsObject, _>(cx).or_throw(cx)?;
        let kind = part.get::<JsString, _, _>(cx, "kind")?.value(cx);
        let name = part.get::<JsString, _, _>(cx, "name")?.value(cx);

        match kind.as_str() {
            "text" => {
                let value = part.get::<JsString, _, _>(cx, "value")?.value(cx);
                descriptors.push(MultipartPartDescriptor::Text { name, value });
            }
            "stream" => {
                let file_name = part.get::<JsString, _, _>(cx, "fileName")?.value(cx);
                let mime_type = part.get::<JsString, _, _>(cx, "mimeType")?.value(cx);
                let length_value: Handle<JsValue> = part.get(cx, "length")?;
                let length = js_value_to_safe_u64(
                    cx,
                    length_value,
                    &format!("multipart.parts[{index}].length"),
                )?;
                let handle_value: Handle<JsValue> = part.get(cx, "uploadHandle")?;
                let handle = js_value_to_safe_u64(
                    cx,
                    handle_value,
                    &format!("multipart.parts[{index}].uploadHandle"),
                )?;

                descriptors.push(MultipartPartDescriptor::Stream(MultipartStreamDescriptor {
                    name,
                    file_name,
                    mime_type,
                    length,
                    handle,
                }));
            }
            _ => {
                return cx.throw_type_error(format!(
                    "multipart.parts[{index}].kind must be 'text' or 'stream'"
                ));
            }
        }
    }

    let mut native_parts = Vec::with_capacity(descriptors.len());

    for descriptor in descriptors {
        match descriptor {
            MultipartPartDescriptor::Text { name, value } => {
                native_parts.push(MultipartPartOptions::Text { name, value });
            }
            MultipartPartDescriptor::Stream(stream) => {
                let receiver = take_upload_receiver(stream.handle)
                    .or_else(|error| cx.throw_error(error.to_string()))?;

                native_parts.push(MultipartPartOptions::Stream {
                    name: stream.name,
                    file_name: stream.file_name,
                    mime_type: stream.mime_type,
                    length: stream.length,
                    receiver,
                });
            }
        }
    }

    Ok(Some(MultipartBodyOptions {
        boundary,
        parts: native_parts,
    }))
}

pub(crate) fn js_object_to_request_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<RequestOptions> {
    let url: Handle<JsString> = obj.get(cx, "url")?;
    let url = url.value(cx);
    let (client_id, client_cache_key) = js_object_to_client_identity(cx, obj)?;

    let emulation = js_object_to_emulation(cx, obj)?;

    let method = obj
        .get_opt(cx, "method")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "GET".to_string());

    let headers = obj
        .get_opt(cx, "headers")?
        .map(|v| js_value_to_header_tuples(cx, v))
        .transpose()?
        .unwrap_or_default();

    let orig_headers = obj
        .get_opt(cx, "origHeaders")?
        .map(|v| js_value_to_string_array(cx, v))
        .transpose()?
        .unwrap_or_default();

    let body_bytes = obj
        .get_opt(cx, "body")?
        .map(|value| js_value_to_bytes(cx, value))
        .transpose()?;
    let multipart = js_object_to_multipart_body(cx, obj)?;

    if body_bytes.is_some() && multipart.is_some() {
        return cx.throw_type_error("body and multipart cannot both be provided");
    }

    let body = match (body_bytes, multipart) {
        (Some(bytes), None) => Some(RequestBody::Bytes(bytes)),
        (None, Some(multipart)) => Some(RequestBody::Multipart(multipart)),
        (None, None) => None,
        (Some(_), Some(_)) => unreachable!(),
    };

    let proxy = obj
        .get_opt(cx, "proxy")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));
    let disable_system_proxy = obj
        .get_opt(cx, "disableSystemProxy")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);
    let dns = js_object_to_dns_options(cx, obj)?;
    let timeout = js_value_to_non_negative_timeout_ms(cx, obj, "timeout")?;
    let read_timeout = js_value_to_non_negative_timeout_ms(cx, obj, "readTimeout")?;
    let connect_timeout = js_value_to_non_negative_timeout_ms(cx, obj, "connectTimeout")?;
    let pool_idle_timeout = js_object_to_pool_idle_timeout(cx, obj)?;
    let pool_max_idle_per_host = obj
        .get_opt(cx, "poolMaxIdlePerHost")?
        .map(|value| js_value_to_non_negative_usize(cx, value, "poolMaxIdlePerHost"))
        .transpose()?;
    let pool_max_size = obj
        .get_opt(cx, "poolMaxSize")?
        .map(|value| js_value_to_positive_usize(cx, value, "poolMaxSize"))
        .transpose()?;
    let tls_session_cache_capacity = obj
        .get_opt(cx, "tlsSessionCacheCapacity")?
        .map(|value| js_value_to_positive_usize(cx, value, "tlsSessionCacheCapacity"))
        .transpose()?;

    let timeout = match timeout {
        Some(0) => None,
        Some(timeout) => Some(timeout),
        None => Some(30000),
    };
    let read_timeout = match read_timeout {
        Some(0) => None,
        Some(timeout) => Some(timeout),
        None => None,
    };
    let connect_timeout = match connect_timeout {
        Some(0) => None,
        Some(timeout) => Some(timeout),
        None => None,
    };

    let disable_default_headers = obj
        .get_opt(cx, "disableDefaultHeaders")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);

    let compress = obj
        .get_opt(cx, "compress")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(true);
    let http1_only = obj
        .get_opt(cx, "http1Only")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);
    let http2_only = obj
        .get_opt(cx, "http2Only")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);
    let local_bind = js_object_to_local_bind_options(cx, obj)?;
    let tls_identity = js_object_to_tls_identity_options(cx, obj)?;
    let certificate_authority = js_object_to_certificate_authority_options(cx, obj)?;
    let tls_debug = js_object_to_tls_debug_options(cx, obj)?;
    let tls_danger = js_object_to_tls_danger_options(cx, obj)?;
    let connection_group = js_object_to_connection_group(cx, obj)?;
    let forbid_connection_reuse = obj
        .get_opt(cx, "forbidConnectionReuse")?
        .and_then(|value: Handle<JsValue>| value.downcast::<JsBoolean, _>(cx).ok())
        .map(|value| value.value(cx))
        .unwrap_or(false);

    Ok(RequestOptions {
        client_id,
        client_cache_key,
        url,
        emulation,
        headers,
        orig_headers,
        method,
        body,
        proxy,
        disable_system_proxy,
        dns,
        timeout,
        read_timeout,
        connect_timeout,
        pool_idle_timeout,
        pool_max_idle_per_host,
        pool_max_size,
        tls_session_cache_capacity,
        disable_default_headers,
        compress,
        http1_only,
        http2_only,
        local_bind,
        tls_identity,
        certificate_authority,
        tls_debug,
        tls_danger,
        connection_group,
        forbid_connection_reuse,
    })
}

pub(crate) fn js_object_to_websocket_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<WebSocketConnectOptions> {
    let url: Handle<JsString> = obj.get(cx, "url")?;
    let url = url.value(cx);
    let (client_id, client_cache_key) = js_object_to_client_identity(cx, obj)?;

    let emulation = js_object_to_emulation(cx, obj)?;

    let headers = obj
        .get_opt(cx, "headers")?
        .map(|v| js_value_to_header_tuples(cx, v))
        .transpose()?
        .unwrap_or_default();

    let orig_headers = obj
        .get_opt(cx, "origHeaders")?
        .map(|v| js_value_to_string_array(cx, v))
        .transpose()?
        .unwrap_or_default();

    let proxy = obj
        .get_opt(cx, "proxy")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));
    let disable_system_proxy = obj
        .get_opt(cx, "disableSystemProxy")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);
    let dns = js_object_to_dns_options(cx, obj)?;
    let timeout = obj
        .get_opt(cx, "timeout")?
        .map(|v| js_value_to_timeout_ms(cx, v))
        .transpose()?;

    let timeout = match timeout {
        Some(0) => None,
        Some(timeout) => Some(timeout),
        None => Some(30000),
    };
    let pool_idle_timeout = js_object_to_pool_idle_timeout(cx, obj)?;
    let pool_max_idle_per_host = obj
        .get_opt(cx, "poolMaxIdlePerHost")?
        .map(|value| js_value_to_non_negative_usize(cx, value, "poolMaxIdlePerHost"))
        .transpose()?;
    let pool_max_size = obj
        .get_opt(cx, "poolMaxSize")?
        .map(|value| js_value_to_positive_usize(cx, value, "poolMaxSize"))
        .transpose()?;
    let tls_session_cache_capacity = obj
        .get_opt(cx, "tlsSessionCacheCapacity")?
        .map(|value| js_value_to_positive_usize(cx, value, "tlsSessionCacheCapacity"))
        .transpose()?;

    let disable_default_headers = obj
        .get_opt(cx, "disableDefaultHeaders")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);

    let mut protocols = Vec::new();
    if let Some(values) = obj.get_opt::<JsArray, _, _>(cx, "protocols")? {
        for value in values.to_vec(cx)? {
            if let Ok(value) = value.downcast::<JsString, _>(cx) {
                protocols.push(value.value(cx));
            }
        }
    }
    let force_http2 = obj
        .get_opt(cx, "forceHttp2")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(false);
    let http_version = obj
        .get_opt(cx, "httpVersion")?
        .map(|value: Handle<JsValue>| value.downcast::<JsString, _>(cx).or_throw(cx))
        .transpose()?
        .map(|value| match value.value(cx).as_str() {
            "1.1" => Ok(wreq::Version::HTTP_11),
            "2" => Ok(wreq::Version::HTTP_2),
            _ => cx.throw_type_error("httpVersion must be '1.1' or '2'"),
        })
        .transpose()?;
    let read_buffer_size = obj
        .get_opt(cx, "readBufferSize")?
        .map(|v| js_value_to_positive_usize(cx, v, "readBufferSize"))
        .transpose()?;
    let write_buffer_size = obj
        .get_opt(cx, "writeBufferSize")?
        .map(|v| js_value_to_positive_usize(cx, v, "writeBufferSize"))
        .transpose()?;
    let max_write_buffer_size = obj
        .get_opt(cx, "maxWriteBufferSize")?
        .map(|v| js_value_to_positive_usize(cx, v, "maxWriteBufferSize"))
        .transpose()?;
    let accept_unmasked_frames = obj
        .get_opt(cx, "acceptUnmaskedFrames")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx));
    let max_frame_size = obj
        .get_opt(cx, "maxFrameSize")?
        .map(|v| js_value_to_positive_usize(cx, v, "maxFrameSize"))
        .transpose()?;
    let max_message_size = obj
        .get_opt(cx, "maxMessageSize")?
        .map(|v| js_value_to_positive_usize(cx, v, "maxMessageSize"))
        .transpose()?;
    let local_bind = js_object_to_local_bind_options(cx, obj)?;
    let tls_identity = js_object_to_tls_identity_options(cx, obj)?;
    let certificate_authority = js_object_to_certificate_authority_options(cx, obj)?;
    let tls_debug = js_object_to_tls_debug_options(cx, obj)?;
    let tls_danger = js_object_to_tls_danger_options(cx, obj)?;

    Ok(WebSocketConnectOptions {
        client_id,
        client_cache_key,
        url,
        emulation,
        headers,
        orig_headers,
        proxy,
        disable_system_proxy,
        dns,
        timeout,
        pool_idle_timeout,
        pool_max_idle_per_host,
        pool_max_size,
        tls_session_cache_capacity,
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
        local_bind,
        tls_identity,
        certificate_authority,
        tls_debug,
        tls_danger,
    })
}

fn js_value_to_bytes(cx: &mut FunctionContext, value: Handle<JsValue>) -> NeonResult<Vec<u8>> {
    let buffer = value.downcast::<JsBuffer, _>(cx).or_throw(cx)?;
    Ok(buffer.as_slice(cx).to_vec())
}

fn js_object_to_tls_identity_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<TlsIdentityOptions>> {
    let Some(identity_obj) = obj
        .get_opt(cx, "tlsIdentity")?
        .map(|value: Handle<JsValue>| value.downcast::<JsObject, _>(cx).or_throw(cx))
        .transpose()?
    else {
        return Ok(None);
    };

    if let Some(archive) = identity_obj
        .get_opt(cx, "pfx")?
        .map(|value| js_value_to_bytes(cx, value))
        .transpose()?
    {
        let passphrase = identity_obj
            .get_opt(cx, "passphrase")?
            .and_then(|value: Handle<JsValue>| value.downcast::<JsString, _>(cx).ok())
            .map(|value| value.value(cx));

        return Ok(Some(TlsIdentityOptions::Pfx {
            archive,
            passphrase,
        }));
    }

    let Some(cert) = identity_obj
        .get_opt(cx, "cert")?
        .map(|value| js_value_to_bytes(cx, value))
        .transpose()?
    else {
        return cx.throw_type_error("tlsIdentity.cert must be a Buffer");
    };

    let Some(key) = identity_obj
        .get_opt(cx, "key")?
        .map(|value| js_value_to_bytes(cx, value))
        .transpose()?
    else {
        return cx.throw_type_error("tlsIdentity.key must be a Buffer");
    };

    Ok(Some(TlsIdentityOptions::Pem { cert, key }))
}

fn js_object_to_certificate_authority_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<CertificateAuthorityOptions>> {
    let Some(authority_obj) = obj
        .get_opt(cx, "ca")?
        .map(|value: Handle<JsValue>| value.downcast::<JsObject, _>(cx).or_throw(cx))
        .transpose()?
    else {
        return Ok(None);
    };

    let certs_array = authority_obj.get::<JsArray, _, _>(cx, "certs")?;
    let certs = certs_array
        .to_vec(cx)?
        .into_iter()
        .map(|value| js_value_to_bytes(cx, value))
        .collect::<NeonResult<Vec<_>>>()?;
    let include_default_roots = authority_obj
        .get_opt(cx, "includeDefaultRoots")?
        .and_then(|value: Handle<JsValue>| value.downcast::<JsBoolean, _>(cx).ok())
        .map(|value| value.value(cx))
        .unwrap_or(false);

    Ok(Some(CertificateAuthorityOptions {
        certs,
        include_default_roots,
    }))
}

fn js_object_to_dns_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<Option<DnsOptions>> {
    let Some(dns_obj) = obj
        .get_opt(cx, "dns")?
        .map(|value: Handle<JsValue>| value.downcast::<JsObject, _>(cx).or_throw(cx))
        .transpose()?
    else {
        return Ok(None);
    };

    let servers = dns_obj
        .get_opt(cx, "servers")?
        .map(|value| js_value_to_string_array(cx, value))
        .transpose()?
        .unwrap_or_default();
    let doh = dns_obj
        .get_opt(cx, "doh")?
        .map(|value: Handle<JsValue>| value.downcast::<JsString, _>(cx).or_throw(cx))
        .transpose()?
        .map(|value| value.value(cx));
    let dot = dns_obj
        .get_opt(cx, "dot")?
        .map(|value: Handle<JsValue>| value.downcast::<JsString, _>(cx).or_throw(cx))
        .transpose()?
        .map(|value| value.value(cx));

    let hosts = dns_obj
        .get_opt(cx, "hosts")?
        .map(|value: Handle<JsValue>| value.downcast::<JsObject, _>(cx).or_throw(cx))
        .transpose()?
        .map(|hosts_obj| {
            let property_names = hosts_obj.get_own_property_names(cx)?;
            let mut entries = Vec::with_capacity(property_names.len(cx) as usize);

            for key in property_names.to_vec(cx)? {
                let hostname = key.downcast::<JsString, _>(cx).or_throw(cx)?.value(cx);
                let values = hosts_obj
                    .get::<JsArray, _, _>(cx, hostname.as_str())?
                    .to_vec(cx)?
                    .into_iter()
                    .map(|value| {
                        value
                            .downcast::<JsString, _>(cx)
                            .or_throw(cx)
                            .map(|value| value.value(cx))
                    })
                    .collect::<NeonResult<Vec<_>>>()?;
                entries.push((hostname, values));
            }

            Ok(entries)
        })
        .transpose()?
        .unwrap_or_default();

    if doh.is_none() && dot.is_none() && servers.is_empty() && hosts.is_empty() {
        return Ok(None);
    }

    Ok(Some(DnsOptions {
        doh,
        dot,
        servers,
        hosts,
    }))
}

pub(crate) fn response_to_js_object<'a, C: Context<'a>>(
    cx: &mut C,
    response: Response,
) -> JsResult<'a, JsObject> {
    let obj = cx.empty_object();

    let status = cx.number(response.status as f64);
    obj.set(cx, "status", status)?;

    let url = cx.string(&response.url);
    obj.set(cx, "url", url)?;

    let headers_array = JsArray::new(cx, response.headers.len());
    for (index, (key, value)) in response.headers.into_iter().enumerate() {
        let tuple = JsArray::new(cx, 2);
        let key_str = cx.string(&key);
        let value_str = cx.string(&value);

        tuple.set(cx, 0, key_str)?;
        tuple.set(cx, 1, value_str)?;
        headers_array.set(cx, index as u32, tuple)?;
    }
    obj.set(cx, "headers", headers_array)?;

    let cookies_obj = cx.empty_object();
    for (key, value) in response.cookies {
        let value_str = cx.string(&value);
        cookies_obj.set(cx, key.as_str(), value_str)?;
    }
    obj.set(cx, "cookies", cookies_obj)?;

    let set_cookies = JsArray::new(cx, response.set_cookies.len());
    for (index, value) in response.set_cookies.into_iter().enumerate() {
        let value_str = cx.string(&value);
        set_cookies.set(cx, index as u32, value_str)?;
    }
    obj.set(cx, "setCookies", set_cookies)?;

    if let Some(tls_info) = response.tls_info {
        let tls_obj = cx.empty_object();

        match tls_info.peer_certificate {
            Some(peer_certificate) => {
                let value = JsBuffer::from_slice(cx, &peer_certificate)?;
                tls_obj.set(cx, "peerCertificate", value)?;
            }
            None => {
                let value = cx.undefined();
                tls_obj.set(cx, "peerCertificate", value)?;
            }
        }

        match tls_info.peer_certificate_chain {
            Some(peer_certificate_chain) => {
                let value = JsArray::new(cx, peer_certificate_chain.len());

                for (index, cert) in peer_certificate_chain.into_iter().enumerate() {
                    let cert = JsBuffer::from_slice(cx, &cert)?;
                    value.set(cx, index as u32, cert)?;
                }

                tls_obj.set(cx, "peerCertificateChain", value)?;
            }
            None => {
                let value = cx.undefined();
                tls_obj.set(cx, "peerCertificateChain", value)?;
            }
        }

        obj.set(cx, "tls", tls_obj)?;
    }

    let body_handle = cx.number(response.body_handle as f64);
    obj.set(cx, "bodyHandle", body_handle)?;

    Ok(obj)
}

pub(crate) fn websocket_to_js_object<'a, C: Context<'a>>(
    cx: &mut C,
    websocket: WebSocketConnection,
) -> JsResult<'a, JsObject> {
    let obj = cx.empty_object();
    let handle = cx.number(websocket.handle as f64);
    let url = cx.string(&websocket.url);

    obj.set(cx, "handle", handle)?;
    obj.set(cx, "url", url)?;

    match websocket.protocol {
        Some(protocol) => {
            let value = cx.string(protocol);
            obj.set(cx, "protocol", value)?;
        }
        None => {
            let value = cx.null();
            obj.set(cx, "protocol", value)?;
        }
    };

    match websocket.extensions {
        Some(extensions) => {
            let value = cx.string(extensions);
            obj.set(cx, "extensions", value)?;
        }
        None => {
            let value = cx.null();
            obj.set(cx, "extensions", value)?;
        }
    };

    Ok(obj)
}
