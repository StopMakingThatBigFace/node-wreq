use crate::store::body_store::store_body;
use crate::transport::cookies::parse_cookie_pair;
use crate::transport::dns::configure_client_builder as configure_dns;
use crate::transport::headers::build_orig_header_map;
use crate::transport::tls::configure_client_builder;
use crate::transport::types::{RequestOptions, Response, ResponseTlsInfo};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::time::Duration;
use wreq::{redirect, tls::TlsInfo, Method};

pub async fn make_request(options: RequestOptions) -> Result<Response> {
    let RequestOptions {
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
    } = options;

    let mut client_builder = wreq::Client::builder()
        .emulation(emulation)
        .cookie_store(true);

    if disable_system_proxy {
        client_builder = client_builder.no_proxy();
    } else if let Some(proxy_url) = &proxy {
        let proxy = wreq::Proxy::all(proxy_url).context("Failed to create proxy")?;
        client_builder = client_builder.proxy(proxy);
    }

    client_builder = configure_dns(client_builder, dns)?;
    client_builder = configure_client_builder(
        client_builder,
        tls_identity,
        certificate_authority,
        tls_debug,
        tls_danger,
    )?;

    if let Some(connect_timeout) = connect_timeout {
        client_builder = client_builder.connect_timeout(Duration::from_millis(connect_timeout));
    }

    if http1_only {
        client_builder = client_builder.http1_only();
    }

    if http2_only {
        client_builder = client_builder.http2_only();
    }

    if let Some(local_bind) = local_bind {
        if let Some(address) = local_bind.address {
            client_builder = client_builder.local_address(address);
        }

        if local_bind.ipv4.is_some() || local_bind.ipv6.is_some() {
            client_builder = client_builder.local_addresses(local_bind.ipv4, local_bind.ipv6);
        }

        if let Some(interface) = local_bind.interface {
            #[cfg(any(
                target_os = "android",
                target_os = "fuchsia",
                target_os = "illumos",
                target_os = "ios",
                target_os = "linux",
                target_os = "macos",
                target_os = "solaris",
                target_os = "tvos",
                target_os = "visionos",
                target_os = "watchos",
            ))]
            {
                client_builder = client_builder.interface(interface);
            }

            #[cfg(not(any(
                target_os = "android",
                target_os = "fuchsia",
                target_os = "illumos",
                target_os = "ios",
                target_os = "linux",
                target_os = "macos",
                target_os = "solaris",
                target_os = "tvos",
                target_os = "visionos",
                target_os = "watchos",
            )))]
            {
                let _ = interface;
            }
        }
    }

    let orig_headers = build_orig_header_map(&orig_headers);
    let client = client_builder
        .build()
        .context("Failed to build HTTP client")?;

    let method = if method.is_empty() { "GET" } else { &method };
    let parsed_method = Method::from_bytes(method.as_bytes())
        .with_context(|| format!("Unsupported HTTP method: {}", method))?;

    let mut request = client.request(parsed_method, &url);

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
        tls_info,
        url: final_url,
    })
}
