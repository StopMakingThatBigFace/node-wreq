use crate::transport::types::DnsOptions;
use anyhow::{bail, Context, Result};
use hickory_resolver::{
    config::{LookupIpStrategy, NameServerConfig, NameServerConfigGroup, ResolverConfig},
    lookup_ip::LookupIpIntoIter,
    name_server::TokioConnectionProvider,
    proto::xfer::Protocol,
    TokioResolver,
};
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use url::Url;
use wreq::dns::{Addrs, Name, Resolve, Resolving};

fn parse_ip_or_socket_addr(value: &str, default_port: u16) -> Result<SocketAddr> {
    if let Ok(socket_addr) = value.parse::<SocketAddr>() {
        return Ok(socket_addr);
    }

    let ip = value
        .parse::<IpAddr>()
        .with_context(|| format!("Invalid DNS server or override address: {value}"))?;

    Ok(SocketAddr::new(ip, default_port))
}

fn parse_override_addresses(addresses: &[String]) -> Result<Vec<SocketAddr>> {
    addresses
        .iter()
        .map(|address| parse_ip_or_socket_addr(address, 0))
        .collect()
}

fn build_name_server_group(servers: &[String]) -> Result<NameServerConfigGroup> {
    let mut group = NameServerConfigGroup::new();

    for server in servers {
        let socket_addr = parse_ip_or_socket_addr(server, 53)
            .with_context(|| format!("Invalid dns.servers entry: {server}"))?;

        for protocol in [Protocol::Udp, Protocol::Tcp] {
            let mut config = NameServerConfig::new(socket_addr, protocol);
            config.trust_negative_responses = true;
            group.push(config);
        }
    }

    Ok(group)
}

fn build_resolver(group: NameServerConfigGroup) -> TokioResolver {
    let mut builder = TokioResolver::builder_with_config(
        ResolverConfig::from_parts(None, Vec::new(), group),
        TokioConnectionProvider::default(),
    );

    builder.options_mut().ip_strategy = LookupIpStrategy::Ipv4AndIpv6;

    builder.build()
}

fn host_override_ips(
    hostname: &str,
    hosts: &[(String, Vec<String>)],
) -> Result<Option<Vec<IpAddr>>> {
    let Some((_, addresses)) = hosts
        .iter()
        .find(|(host, _)| host.eq_ignore_ascii_case(hostname))
    else {
        return Ok(None);
    };

    let ips = parse_override_addresses(addresses)?
        .into_iter()
        .map(|address| address.ip())
        .collect();

    Ok(Some(ips))
}

fn doh_endpoint_path(url: &Url) -> String {
    let mut endpoint = match url.path() {
        "" | "/" => "/dns-query".to_string(),
        path => path.to_string(),
    };

    if let Some(query) = url.query() {
        endpoint.push('?');
        endpoint.push_str(query);
    }

    endpoint
}

async fn resolve_encrypted_dns_host(
    hostname: &str,
    port: u16,
    servers: &[String],
    hosts: &[(String, Vec<String>)],
    protocol_name: &str,
) -> Result<Vec<IpAddr>> {
    if let Ok(ip) = hostname.parse::<IpAddr>() {
        return Ok(vec![ip]);
    }

    if let Some(ips) = host_override_ips(hostname, hosts)? {
        return Ok(ips);
    }

    let ips = if servers.is_empty() {
        tokio::net::lookup_host((hostname, port))
            .await
            .with_context(|| {
                format!("Failed to resolve {protocol_name} endpoint with system DNS: {hostname}")
            })?
            .map(|address| address.ip())
            .collect::<Vec<_>>()
    } else {
        build_resolver(build_name_server_group(servers)?)
            .lookup_ip(hostname)
            .await
            .with_context(|| {
                format!("Failed to resolve {protocol_name} endpoint with dns.servers: {hostname}")
            })?
            .into_iter()
            .collect::<Vec<_>>()
    };

    let mut seen = HashSet::new();
    let mut deduped = ips
        .into_iter()
        .filter(|ip| seen.insert(*ip))
        .collect::<Vec<_>>();

    if deduped.is_empty() {
        bail!("{protocol_name} endpoint did not resolve to any IP addresses: {hostname}");
    }

    deduped.sort_by_key(|ip| ip.is_ipv6());

    Ok(deduped)
}

async fn build_doh_name_server_group(
    doh: &str,
    servers: &[String],
    hosts: &[(String, Vec<String>)],
) -> Result<NameServerConfigGroup> {
    let url = Url::parse(doh).with_context(|| format!("Invalid dns.doh URL: {doh}"))?;

    if url.scheme() != "https" {
        bail!("dns.doh must be an HTTPS URL: {doh}");
    }

    if !url.username().is_empty() || url.password().is_some() {
        bail!("dns.doh must not include credentials: {doh}");
    }

    if url.fragment().is_some() {
        bail!("dns.doh must not include a fragment: {doh}");
    }

    let hostname = url
        .host_str()
        .with_context(|| format!("dns.doh URL must include a hostname: {doh}"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let endpoint = doh_endpoint_path(&url);
    let ips = resolve_encrypted_dns_host(hostname, port, servers, hosts, "DoH").await?;
    let mut group = NameServerConfigGroup::new();

    for ip in ips {
        let mut config = NameServerConfig::new(SocketAddr::new(ip, port), Protocol::Https);
        config.tls_dns_name = Some(hostname.to_string());
        config.http_endpoint = Some(endpoint.clone());
        config.trust_negative_responses = true;
        group.push(config);
    }

    Ok(group)
}

async fn build_dot_name_server_group(
    dot: &str,
    servers: &[String],
    hosts: &[(String, Vec<String>)],
) -> Result<NameServerConfigGroup> {
    let url = Url::parse(dot).with_context(|| format!("Invalid dns.dot URL: {dot}"))?;

    if url.scheme() != "tls" {
        bail!("dns.dot must be a tls:// URL: {dot}");
    }

    if !url.username().is_empty() || url.password().is_some() {
        bail!("dns.dot must not include credentials: {dot}");
    }

    if url.fragment().is_some() {
        bail!("dns.dot must not include a fragment: {dot}");
    }

    if url.query().is_some() || !matches!(url.path(), "" | "/") {
        bail!("dns.dot must not include a path or query: {dot}");
    }

    let hostname = url
        .host_str()
        .with_context(|| format!("dns.dot URL must include a hostname: {dot}"))?;
    let port = url.port().unwrap_or(853);
    let ips = resolve_encrypted_dns_host(hostname, port, servers, hosts, "DoT").await?;
    let mut group = NameServerConfigGroup::new();

    for ip in ips {
        let mut config = NameServerConfig::new(SocketAddr::new(ip, port), Protocol::Tls);
        config.tls_dns_name = Some(hostname.to_string());
        config.trust_negative_responses = true;
        group.push(config);
    }

    Ok(group)
}

#[derive(Clone, Debug)]
struct CustomDnsResolver {
    resolver: TokioResolver,
}

impl CustomDnsResolver {
    fn new(group: NameServerConfigGroup) -> Self {
        Self {
            resolver: build_resolver(group),
        }
    }
}

struct SocketAddrs {
    iter: LookupIpIntoIter,
}

impl Resolve for CustomDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver = self.clone();

        Box::pin(async move {
            let lookup = resolver.resolver.lookup_ip(name.as_str()).await?;
            let addrs: Addrs = Box::new(SocketAddrs {
                iter: lookup.into_iter(),
            });

            Ok(addrs)
        })
    }
}

impl Iterator for SocketAddrs {
    type Item = SocketAddr;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next().map(|ip_addr| SocketAddr::new(ip_addr, 0))
    }
}

pub async fn configure_client_builder(
    mut client_builder: wreq::ClientBuilder,
    dns: Option<DnsOptions>,
) -> Result<wreq::ClientBuilder> {
    client_builder = client_builder.no_hickory_dns();

    let Some(dns) = dns else {
        return Ok(client_builder);
    };

    if dns.doh.is_some() && dns.dot.is_some() {
        bail!("dns.doh and dns.dot cannot both be set");
    }

    if let Some(doh) = &dns.doh {
        let group = build_doh_name_server_group(doh, &dns.servers, &dns.hosts).await?;
        client_builder = client_builder.dns_resolver(CustomDnsResolver::new(group));
    } else if let Some(dot) = &dns.dot {
        let group = build_dot_name_server_group(dot, &dns.servers, &dns.hosts).await?;
        client_builder = client_builder.dns_resolver(CustomDnsResolver::new(group));
    } else if !dns.servers.is_empty() {
        client_builder = client_builder.dns_resolver(CustomDnsResolver::new(
            build_name_server_group(&dns.servers)?,
        ));
    }

    for (hostname, addresses) in dns.hosts {
        let parsed = parse_override_addresses(&addresses)?;
        client_builder = client_builder.resolve_to_addrs(hostname, parsed);
    }

    Ok(client_builder)
}
