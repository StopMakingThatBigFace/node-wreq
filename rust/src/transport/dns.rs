use crate::transport::types::DnsOptions;
use anyhow::{Context, Result};
use hickory_resolver::{
    TokioResolver,
    config::{LookupIpStrategy, NameServerConfig, NameServerConfigGroup, ResolverConfig},
    lookup_ip::LookupIpIntoIter,
    name_server::TokioConnectionProvider,
    proto::xfer::Protocol,
};
use std::net::{IpAddr, SocketAddr};
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

#[derive(Clone, Debug)]
struct CustomDnsResolver {
    resolver: TokioResolver,
}

impl CustomDnsResolver {
    fn new(servers: &[String]) -> Result<Self> {
        let mut builder = TokioResolver::builder_with_config(
            ResolverConfig::from_parts(None, Vec::new(), build_name_server_group(servers)?),
            TokioConnectionProvider::default(),
        );

        builder.options_mut().ip_strategy = LookupIpStrategy::Ipv4AndIpv6;

        Ok(Self {
            resolver: builder.build(),
        })
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

pub fn configure_client_builder(
    mut client_builder: wreq::ClientBuilder,
    dns: Option<DnsOptions>,
) -> Result<wreq::ClientBuilder> {
    client_builder = client_builder.no_hickory_dns();

    let Some(dns) = dns else {
        return Ok(client_builder);
    };

    if !dns.servers.is_empty() {
        client_builder = client_builder.dns_resolver(CustomDnsResolver::new(&dns.servers)?);
    }

    for (hostname, addresses) in dns.hosts {
        let parsed = parse_override_addresses(&addresses)?;
        client_builder = client_builder.resolve_to_addrs(hostname, parsed);
    }

    Ok(client_builder)
}
