export type { BrowserProfile } from '../config/generated/browser-profiles';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export type HeaderTuple = [string, string];

export type HeadersInit =
  | Record<string, string | number | boolean | null | undefined>
  | HeaderTuple[]
  | Iterable<HeaderTuple>;

export type BodyInit = string | URLSearchParams | Buffer | ArrayBuffer | ArrayBufferView;

export type AlpnProtocol = 'HTTP1' | 'HTTP2' | 'HTTP3';
export type AlpsProtocol = 'HTTP1' | 'HTTP2' | 'HTTP3';
export type TlsVersion = '1.0' | '1.1' | '1.2' | '1.3' | 'TLS1.0' | 'TLS1.1' | 'TLS1.2' | 'TLS1.3';
export type Http2PseudoHeaderId = 'Method' | 'Scheme' | 'Authority' | 'Path' | 'Protocol';
export type Http2SettingId =
  | 'HeaderTableSize'
  | 'EnablePush'
  | 'MaxConcurrentStreams'
  | 'InitialWindowSize'
  | 'MaxFrameSize'
  | 'MaxHeaderListSize'
  | 'EnableConnectProtocol'
  | 'NoRfc7540Priorities';

export interface Http2StreamDependency {
  dependencyId: number;
  weight: number;
  exclusive?: boolean;
}

export interface Http2Priority {
  streamId: number;
  dependency: Http2StreamDependency;
}

export interface Http2ExperimentalSetting {
  id: number;
  value: number;
}

export interface TlsOptions {
  alpnProtocols?: AlpnProtocol[];
  alpsProtocols?: AlpsProtocol[];
  alpsUseNewCodepoint?: boolean;
  sessionTicket?: boolean;
  minTlsVersion?: TlsVersion;
  maxTlsVersion?: TlsVersion;
  preSharedKey?: boolean;
  enableEchGrease?: boolean;
  permuteExtensions?: boolean;
  greaseEnabled?: boolean;
  enableOcspStapling?: boolean;
  enableSignedCertTimestamps?: boolean;
  recordSizeLimit?: number;
  pskSkipSessionTicket?: boolean;
  keySharesLimit?: number;
  pskDheKe?: boolean;
  renegotiation?: boolean;
  delegatedCredentials?: string;
  curvesList?: string;
  cipherList?: string;
  sigalgsList?: string;
  certificateCompressionAlgorithms?: Array<'zlib' | 'brotli' | 'zstd'>;
  extensionPermutation?: number[];
  aesHwOverride?: boolean;
  preserveTls13CipherList?: boolean;
  randomAesHwOverride?: boolean;
}

export interface Http1Options {
  http09Responses?: boolean;
  writev?: boolean;
  maxHeaders?: number;
  readBufExactSize?: number;
  maxBufSize?: number;
  ignoreInvalidHeadersInResponses?: boolean;
  allowSpacesAfterHeaderNameInResponses?: boolean;
  allowObsoleteMultilineHeadersInResponses?: boolean;
}

export interface Http2Options {
  adaptiveWindow?: boolean;
  initialStreamId?: number;
  initialConnectionWindowSize?: number;
  initialWindowSize?: number;
  initialMaxSendStreams?: number;
  maxFrameSize?: number;
  keepAliveInterval?: number;
  keepAliveTimeout?: number;
  keepAliveWhileIdle?: boolean;
  maxConcurrentResetStreams?: number;
  maxSendBufferSize?: number;
  maxConcurrentStreams?: number;
  maxHeaderListSize?: number;
  maxPendingAcceptResetStreams?: number;
  enablePush?: boolean;
  headerTableSize?: number;
  enableConnectProtocol?: boolean;
  noRfc7540Priorities?: boolean;
  settingsOrder?: Http2SettingId[];
  headersPseudoOrder?: Http2PseudoHeaderId[];
  headersStreamDependency?: Http2StreamDependency;
  priorities?: Http2Priority[];
  experimentalSettings?: Http2ExperimentalSetting[];
}

export interface CookieJarCookie {
  name: string;
  value: string;
}

export interface CookieJar {
  getCookies(url: string): Promise<CookieJarCookie[]> | CookieJarCookie[];
  setCookie(cookie: string, url: string): Promise<void> | void;
}

export interface RequestTimings {
  startTime: number;
  responseStart: number;
  wait: number;
  endTime?: number;
  total?: number;
}
