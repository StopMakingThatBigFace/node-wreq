use crate::store::body_store::store_body;
use crate::transport::client::request_client;
use crate::transport::cookies::parse_cookie_pair;
use crate::transport::headers::build_orig_header_map;
use crate::transport::types::{ConnectionGroup, RequestOptions, Response, ResponseTlsInfo};
use anyhow::{Context, Result};
use std::time::Duration;
use wreq::{redirect, tls::TlsInfo, Group, Method};

pub async fn make_request(options: RequestOptions) -> Result<Response> {
    let client = request_client(&options).await?;
    let RequestOptions {
        client_id: _,
        client_cache_key: _,
        url,
        emulation: _,
        headers,
        orig_headers,
        method,
        body,
        proxy: _,
        disable_system_proxy: _,
        dns: _,
        timeout,
        read_timeout,
        connect_timeout: _,
        pool_idle_timeout: _,
        pool_max_idle_per_host: _,
        pool_max_size: _,
        tls_session_cache_capacity: _,
        disable_default_headers,
        compress,
        http1_only: _,
        http2_only: _,
        local_bind: _,
        tls_identity: _,
        certificate_authority: _,
        tls_debug: _,
        tls_danger: _,
        connection_group,
        forbid_connection_reuse,
    } = options;

    let orig_headers = build_orig_header_map(&orig_headers);

    let method = if method.is_empty() { "GET" } else { &method };
    let parsed_method = Method::from_bytes(method.as_bytes())
        .with_context(|| format!("Unsupported HTTP method: {}", method))?;

    let mut request = client.request(parsed_method, &url);

    if let Some(group) = connection_group {
        request = request.group(match group {
            ConnectionGroup::Name(name) => Group::new(name),
            ConnectionGroup::Number(number) => Group::new(number),
        });
    }

    for (key, value) in &headers {
        request = request.header(key, value);
    }

    if !orig_headers.is_empty() {
        request = request.orig_headers(orig_headers);
    }

    if let Some(body) = body {
        request = request.body(body);
    }

    if let Some(timeout) = timeout {
        request = request.timeout(Duration::from_millis(timeout));
    }
    if let Some(read_timeout) = read_timeout {
        request = request.read_timeout(Duration::from_millis(read_timeout));
    }
    request = request.redirect(redirect::Policy::none());
    request = request.default_headers(!disable_default_headers);
    request = request.gzip(compress);
    request = request.brotli(compress);
    request = request.zstd(compress);
    request = request.deflate(compress);

    let response = request
        .send()
        .await
        .with_context(|| format!("{} {}", method, url))?;

    if forbid_connection_reuse {
        response.forbid_recycle();
    }

    let tls_info = response
        .extensions()
        .get::<TlsInfo>()
        .cloned()
        .map(|tls_info| ResponseTlsInfo {
            peer_certificate: tls_info.peer_certificate().map(|cert| cert.to_vec()),
            peer_certificate_chain: tls_info
                .peer_certificate_chain()
                .map(|chain| chain.map(|cert| cert.to_vec()).collect()),
        });

    let status = response.status().as_u16();
    let final_url = response.uri().to_string();

    let mut response_headers = Vec::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            response_headers.push((key.to_string(), value_str.to_string()));
        }
    }

    let mut cookies = std::collections::HashMap::new();
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
        tls_info,
        url: final_url,
    })
}
