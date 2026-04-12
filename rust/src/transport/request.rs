use crate::store::body_store::store_body;
use crate::store::runtime::runtime;
use crate::transport::cookies::parse_cookie_pair;
use crate::transport::headers::build_orig_header_map;
use crate::transport::types::{RequestOptions, Response};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::time::Duration;
use wreq::redirect;

pub fn execute_request(options: RequestOptions) -> Result<Response> {
    runtime().block_on(make_request(options))
}

pub async fn make_request(options: RequestOptions) -> Result<Response> {
    let mut client_builder = wreq::Client::builder()
        .emulation(options.emulation)
        .cookie_store(true);

    if let Some(proxy_url) = &options.proxy {
        let proxy = wreq::Proxy::all(proxy_url).context("Failed to create proxy")?;
        client_builder = client_builder.proxy(proxy);
    }

    let orig_headers = build_orig_header_map(&options.orig_headers);
    let client = client_builder
        .build()
        .context("Failed to build HTTP client")?;

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

    if !orig_headers.is_empty() {
        request = request.orig_headers(orig_headers);
    }

    if let Some(body) = options.body {
        request = request.body(body);
    }

    request = request.timeout(Duration::from_millis(options.timeout));
    request = request.redirect(redirect::Policy::none());
    request = request.default_headers(!options.disable_default_headers);
    request = request.gzip(options.compress);
    request = request.brotli(options.compress);
    request = request.deflate(options.compress);

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
