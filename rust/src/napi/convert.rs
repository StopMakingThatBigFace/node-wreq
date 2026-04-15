use crate::emulation::resolve_emulation;
use crate::napi::profiles::parse_browser_emulation;
use crate::transport::types::{
    CertificateAuthorityOptions, DnsOptions, RequestOptions, Response, TlsIdentityOptions,
    WebSocketConnectOptions, WebSocketConnection,
};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use neon::types::JsBuffer;

fn js_value_to_timeout_ms(cx: &mut FunctionContext, value: Handle<JsValue>) -> NeonResult<u64> {
    let value = value.downcast::<JsNumber, _>(cx).or_throw(cx)?.value(cx);

    if !value.is_finite() || value < 0.0 {
        return cx.throw_type_error("timeout must be a finite non-negative number");
    }

    Ok(if value == 0.0 { 0 } else { value.ceil() as u64 })
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

    let compress = obj
        .get_opt(cx, "compress")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsBoolean, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or(true);
    let tls_identity = js_object_to_tls_identity_options(cx, obj)?;
    let certificate_authority = js_object_to_certificate_authority_options(cx, obj)?;

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
        disable_default_headers,
        compress,
        tls_identity,
        certificate_authority,
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
    let tls_identity = js_object_to_tls_identity_options(cx, obj)?;
    let certificate_authority = js_object_to_certificate_authority_options(cx, obj)?;

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
        tls_identity,
        certificate_authority,
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
