use crate::store::client_store::{get_client, insert_client};
use crate::transport::dns::configure_client_builder as configure_dns;
use crate::transport::tls::configure_client_builder as configure_tls;
use crate::transport::types::{
    CertificateAuthorityOptions, DnsOptions, LocalBindOptions, PoolIdleTimeout, RequestOptions,
    TlsDangerOptions, TlsDebugOptions, TlsIdentityOptions, WebSocketConnectOptions,
};
use anyhow::{Context, Result};
use std::time::Duration;
use wreq::tls::session::LruTlsSessionCache;
use wreq::{Client, Emulation};

#[derive(Clone)]
struct ClientConfig {
    owner: Option<u64>,
    cache_key: Option<String>,
    emulation: Emulation,
    proxy: Option<String>,
    disable_system_proxy: bool,
    dns: Option<DnsOptions>,
    timeout: Option<u64>,
    connect_timeout: Option<u64>,
    pool_idle_timeout: Option<PoolIdleTimeout>,
    pool_max_idle_per_host: Option<usize>,
    pool_max_size: Option<usize>,
    tls_session_cache_capacity: Option<usize>,
    http1_only: bool,
    http2_only: bool,
    local_bind: Option<LocalBindOptions>,
    tls_identity: Option<TlsIdentityOptions>,
    certificate_authority: Option<CertificateAuthorityOptions>,
    tls_debug: Option<TlsDebugOptions>,
    tls_danger: Option<TlsDangerOptions>,
}

impl From<&RequestOptions> for ClientConfig {
    fn from(options: &RequestOptions) -> Self {
        Self {
            owner: options.client_id,
            cache_key: options.client_cache_key.clone(),
            emulation: options.emulation.clone(),
            proxy: options.proxy.clone(),
            disable_system_proxy: options.disable_system_proxy,
            dns: options.dns.clone(),
            timeout: None,
            connect_timeout: options.connect_timeout,
            pool_idle_timeout: options.pool_idle_timeout.clone(),
            pool_max_idle_per_host: options.pool_max_idle_per_host,
            pool_max_size: options.pool_max_size,
            tls_session_cache_capacity: options.tls_session_cache_capacity,
            http1_only: options.http1_only,
            http2_only: options.http2_only,
            local_bind: options.local_bind.clone(),
            tls_identity: options.tls_identity.clone(),
            certificate_authority: options.certificate_authority.clone(),
            tls_debug: options.tls_debug.clone(),
            tls_danger: options.tls_danger.clone(),
        }
    }
}

impl From<&WebSocketConnectOptions> for ClientConfig {
    fn from(options: &WebSocketConnectOptions) -> Self {
        Self {
            owner: options.client_id,
            cache_key: options.client_cache_key.clone(),
            emulation: options.emulation.clone(),
            proxy: options.proxy.clone(),
            disable_system_proxy: options.disable_system_proxy,
            dns: options.dns.clone(),
            timeout: options.timeout,
            connect_timeout: None,
            pool_idle_timeout: options.pool_idle_timeout.clone(),
            pool_max_idle_per_host: options.pool_max_idle_per_host,
            pool_max_size: options.pool_max_size,
            tls_session_cache_capacity: options.tls_session_cache_capacity,
            http1_only: false,
            http2_only: false,
            local_bind: options.local_bind.clone(),
            tls_identity: options.tls_identity.clone(),
            certificate_authority: options.certificate_authority.clone(),
            tls_debug: options.tls_debug.clone(),
            tls_danger: options.tls_danger.clone(),
        }
    }
}

pub async fn request_client(options: &RequestOptions) -> Result<Client> {
    resolve_client(ClientConfig::from(options)).await
}

pub async fn websocket_client(options: &WebSocketConnectOptions) -> Result<Client> {
    resolve_client(ClientConfig::from(options)).await
}

async fn resolve_client(config: ClientConfig) -> Result<Client> {
    if let (Some(owner), Some(key)) = (config.owner, config.cache_key.as_deref()) {
        if let Some(client) = get_client(owner, key) {
            return Ok(client);
        }
    }

    let owner = config.owner;
    let cache_key = config.cache_key.clone();
    let client = build_client(config).await?;

    Ok(match (owner, cache_key) {
        (Some(owner), Some(key)) => insert_client(owner, key, client),
        _ => client,
    })
}

async fn build_client(config: ClientConfig) -> Result<Client> {
    let mut builder = Client::builder().emulation(config.emulation);

    if config.disable_system_proxy {
        builder = builder.no_proxy();
    } else if let Some(proxy_url) = &config.proxy {
        let proxy = wreq::Proxy::all(proxy_url).context("Failed to create proxy")?;
        builder = builder.proxy(proxy);
    }

    builder = configure_dns(builder, config.dns).await?;
    builder = configure_tls(
        builder,
        config.tls_identity,
        config.certificate_authority,
        config.tls_debug,
        config.tls_danger,
    )?;

    if let Some(timeout) = config.timeout {
        builder = builder.timeout(Duration::from_millis(timeout));
    }
    if let Some(connect_timeout) = config.connect_timeout {
        builder = builder.connect_timeout(Duration::from_millis(connect_timeout));
    }
    if let Some(pool_idle_timeout) = config.pool_idle_timeout {
        builder = match pool_idle_timeout {
            PoolIdleTimeout::Disabled => builder.pool_idle_timeout(None),
            PoolIdleTimeout::Millis(value) => {
                builder.pool_idle_timeout(Some(Duration::from_millis(value)))
            }
        };
    }
    if let Some(max) = config.pool_max_idle_per_host {
        builder = builder.pool_max_idle_per_host(max);
    }
    if let Some(max) = config.pool_max_size {
        builder = builder.pool_max_size(max);
    }
    if let Some(capacity) = config.tls_session_cache_capacity {
        builder = builder.tls_session_cache(LruTlsSessionCache::new(capacity));
    }
    if config.http1_only {
        builder = builder.http1_only();
    }
    if config.http2_only {
        builder = builder.http2_only();
    }

    builder = configure_local_bind(builder, config.local_bind);

    builder.build().context("Failed to build HTTP client")
}

fn configure_local_bind(
    mut builder: wreq::ClientBuilder,
    local_bind: Option<LocalBindOptions>,
) -> wreq::ClientBuilder {
    let Some(local_bind) = local_bind else {
        return builder;
    };

    if let Some(address) = local_bind.address {
        builder = builder.local_address(address);
    }
    if local_bind.ipv4.is_some() || local_bind.ipv6.is_some() {
        builder = builder.local_addresses(local_bind.ipv4, local_bind.ipv6);
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
            builder = builder.interface(interface);
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

    builder
}
