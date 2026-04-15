import { isIP } from 'node:net';
import type {
  DnsOptions,
  NativeDnsOptions,
  NativeLocalAddresses,
  WebSocketInit,
  WreqInit,
} from '../types';

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

type BindInput = Pick<WreqInit, 'localAddress' | 'localAddresses' | 'interface'> &
  Pick<WebSocketInit, 'localAddress' | 'localAddresses' | 'interface'>;

type NormalizedLocalBind = {
  localAddress?: string;
  localAddresses?: NativeLocalAddresses;
  interface?: string;
};

export function normalizeLocalBindOptions(input: BindInput): NormalizedLocalBind {
  const localAddress = input.localAddress?.trim();
  const interfaceName = input.interface?.trim();
  const ipv4 = input.localAddresses?.ipv4?.trim();
  const ipv6 = input.localAddresses?.ipv6?.trim();

  if (localAddress && isIP(localAddress) === 0) {
    throw new TypeError(`localAddress must be a valid IPv4 or IPv6 address: ${input.localAddress}`);
  }

  if (ipv4 && isIP(ipv4) !== 4) {
    throw new TypeError(
      `localAddresses.ipv4 must be a valid IPv4 address: ${input.localAddresses?.ipv4}`
    );
  }

  if (ipv6 && isIP(ipv6) !== 6) {
    throw new TypeError(
      `localAddresses.ipv6 must be a valid IPv6 address: ${input.localAddresses?.ipv6}`
    );
  }

  if (input.interface !== undefined && !interfaceName) {
    throw new TypeError('interface must be a non-empty string');
  }

  const normalized: NormalizedLocalBind = {};

  if (localAddress) {
    normalized.localAddress = localAddress;
  }

  if (ipv4 || ipv6) {
    normalized.localAddresses = {
      ...(ipv4 ? { ipv4 } : {}),
      ...(ipv6 ? { ipv6 } : {}),
    };
  }

  if (interfaceName) {
    normalized.interface = interfaceName;
  }

  return normalized;
}
