use crate::emulation::resolve_emulation;
use crate::napi::profiles::parse_browser_emulation;
use crate::transport::types::{
    CertificateAuthorityOptions, DnsOptions, LocalBindOptions, RequestOptions, Response,
    TlsDangerOptions, TlsDebugOptions, TlsIdentityOptions, TlsKeylogOptions,
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

pub(crate) fn js_object_to_request_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<RequestOptions> {
    let url: Handle<JsString> = obj.get(cx, "url")?;
    let url = url.value(cx);

    let browser_str = obj
        .get_opt(cx, "browser")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "chrome_137".to_string());

    let emulation_json = obj
        .get_opt(cx, "emulationJson")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    let emulation = resolve_emulation(
        parse_browser_emulation(&browser_str),
        emulation_json.as_deref(),
    )
    .or_else(|error| cx.throw_error(format!("{:#}", error)))?;

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

    let body = obj
        .get_opt(cx, "body")?
        .map(|value| js_value_to_bytes(cx, value))
        .transpose()?;

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

    Ok(RequestOptions {
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
        disable_default_headers,
        compress,
        http1_only,
        http2_only,
        local_bind,
        tls_identity,
        certificate_authority,
        tls_debug,
        tls_danger,
    })
}

pub(crate) fn js_object_to_websocket_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<WebSocketConnectOptions> {
    let url: Handle<JsString> = obj.get(cx, "url")?;
    let url = url.value(cx);

    let browser_str = obj
        .get_opt(cx, "browser")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "chrome_137".to_string());

    let emulation_json = obj
        .get_opt(cx, "emulationJson")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    let emulation = resolve_emulation(
        parse_browser_emulation(&browser_str),
        emulation_json.as_deref(),
    )
    .or_else(|error| cx.throw_error(format!("{:#}", error)))?;

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
        url,
        emulation,
        headers,
        orig_headers,
        proxy,
        disable_system_proxy,
        dns,
        timeout,
        disable_default_headers,
        protocols,
        force_http2,
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

    if servers.is_empty() && hosts.is_empty() {
        return Ok(None);
    }

    Ok(Some(DnsOptions { servers, hosts }))
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

    let headers_obj = cx.empty_object();
    for (key, value) in response.headers {
        let value_str = cx.string(&value);
        headers_obj.set(cx, key.as_str(), value_str)?;
    }
    obj.set(cx, "headers", headers_obj)?;

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
