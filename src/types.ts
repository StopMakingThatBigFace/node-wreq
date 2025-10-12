/**
 * Browser profile names supported
 */
export type BrowserProfile =
  // Chrome
  | 'chrome_100'
  | 'chrome_101'
  | 'chrome_104'
  | 'chrome_105'
  | 'chrome_106'
  | 'chrome_107'
  | 'chrome_108'
  | 'chrome_109'
  | 'chrome_110'
  | 'chrome_114'
  | 'chrome_116'
  | 'chrome_117'
  | 'chrome_118'
  | 'chrome_119'
  | 'chrome_120'
  | 'chrome_123'
  | 'chrome_124'
  | 'chrome_126'
  | 'chrome_127'
  | 'chrome_128'
  | 'chrome_129'
  | 'chrome_130'
  | 'chrome_131'
  | 'chrome_132'
  | 'chrome_133'
  | 'chrome_134'
  | 'chrome_135'
  | 'chrome_136'
  | 'chrome_137'
  // Edge
  | 'edge_101'
  | 'edge_122'
  | 'edge_127'
  | 'edge_131'
  | 'edge_134'
  // Safari
  | 'safari_ios_17_2'
  | 'safari_ios_17_4_1'
  | 'safari_ios_16_5'
  | 'safari_15_3'
  | 'safari_15_5'
  | 'safari_15_6_1'
  | 'safari_16'
  | 'safari_16_5'
  | 'safari_17_0'
  | 'safari_17_2_1'
  | 'safari_17_4_1'
  | 'safari_17_5'
  | 'safari_18'
  | 'safari_ipad_18'
  | 'safari_18_2'
  | 'safari_ios_18_1_1'
  | 'safari_18_3'
  | 'safari_18_3_1'
  | 'safari_18_5'
  // Firefox
  | 'firefox_109'
  | 'firefox_117'
  | 'firefox_128'
  | 'firefox_133'
  | 'firefox_135'
  | 'firefox_private_135'
  | 'firefox_android_135'
  | 'firefox_136'
  | 'firefox_private_136'
  | 'firefox_139'
  // Opera
  | 'opera_116'
  | 'opera_117'
  | 'opera_118'
  | 'opera_119'
  // OkHttp
  | 'okhttp_3_9'
  | 'okhttp_3_11'
  | 'okhttp_3_13'
  | 'okhttp_3_14'
  | 'okhttp_4_9'
  | 'okhttp_4_10'
  | 'okhttp_4_12'
  | 'okhttp_5';

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

/**
 * Request options for making HTTP requests with browser impersonation
 */
export interface RequestOptions {
  /**
   * The URL to request
   */
  url: string;

  /**
   * Browser profile to impersonate
   * @default 'chrome_137'
   */
  browser?: BrowserProfile;

  /**
   * HTTP method
   * @default 'GET'
   */
  method?: HttpMethod;

  /**
   * Additional headers to send with the request
   * Browser-specific headers will be automatically added
   */
  headers?: Record<string, string>;

  /**
   * Request body (for POST, PUT, PATCH requests)
   */
  body?: string;

  /**
   * Proxy URL (e.g., 'http://proxy.example.com:8080')
   */
  proxy?: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;
}

/**
 * Response object returned from HTTP requests
 */
export interface Response {
  /**
   * HTTP status code
   */
  status: number;

  /**
   * Response headers
   */
  headers: Record<string, string>;

  /**
   * Response body as string
   */
  body: string;

  /**
   * Cookies set by the server
   */
  cookies: Record<string, string>;

  /**
   * Final URL after redirects
   */
  url: string;
}

/**
 * WebSocket options for creating a connection
 */
export interface WebSocketOptions {
  /**
   * The WebSocket URL to connect to (wss:// or ws://)
   */
  url: string;

  /**
   * Browser profile to impersonate
   * @default 'chrome_137'
   */
  browser?: BrowserProfile;

  /**
   * Additional headers to send with the WebSocket upgrade request
   */
  headers?: Record<string, string>;

  /**
   * Proxy URL (e.g., 'http://proxy.example.com:8080')
   */
  proxy?: string;

  /**
   * Callback for incoming messages (required)
   */
  onMessage: (data: string | Buffer) => void;

  /**
   * Callback for connection close event
   */
  onClose?: () => void;

  /**
   * Callback for error events
   */
  onError?: (error: string) => void;
}

/**
 * Internal WebSocket connection object returned from native binding
 */
export interface NativeWebSocketConnection {
  _id: number;
}

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestError';
  }
}
