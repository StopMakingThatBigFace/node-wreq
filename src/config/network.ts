import type { DnsOptions, NativeDnsOptions, WreqInit } from '../types';

export function normalizeProxyOptions(proxy: WreqInit['proxy']): {
  proxy?: string;
  disableSystemProxy?: boolean;
} {
  if (proxy === false) {
    return {
      proxy: undefined,
      disableSystemProxy: true,
    };
  }

  return {
    proxy: proxy ?? undefined,
    disableSystemProxy: false,
  };
}

export function normalizeDnsOptions(dns?: DnsOptions): NativeDnsOptions | undefined {
  if (!dns) {
    return undefined;
  }

  const servers = dns.servers
    ? (Array.isArray(dns.servers) ? dns.servers : [dns.servers])
        .map((server) => server.trim())
        .filter((server) => server.length > 0)
    : undefined;

  const hosts = dns.hosts
    ? Object.fromEntries(
        Object.entries(dns.hosts).map(([hostname, value]) => [
          hostname,
          Array.isArray(value) ? [...value] : [value],
        ])
      )
    : undefined;

  if ((!servers || servers.length === 0) && !hosts) {
    return undefined;
  }

  return {
    servers,
    hosts,
  };
}
