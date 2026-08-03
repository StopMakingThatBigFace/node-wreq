use crate::store::upload_store::UploadReceiver;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use wreq::Emulation;

#[derive(Debug, Clone)]
pub enum TlsIdentityOptions {
    Pem {
        cert: Vec<u8>,
        key: Vec<u8>,
    },
    Pfx {
        archive: Vec<u8>,
        passphrase: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct CertificateAuthorityOptions {
    pub certs: Vec<Vec<u8>>,
    pub include_default_roots: bool,
}

#[derive(Debug, Clone)]
pub enum TlsKeylogOptions {
    FromEnv,
    File { path: String },
}

#[derive(Debug, Clone)]
pub struct TlsDebugOptions {
    pub peer_certificates: bool,
    pub keylog: Option<TlsKeylogOptions>,
}

#[derive(Debug, Clone)]
pub struct TlsDangerOptions {
    pub cert_verification: Option<bool>,
    pub verify_hostname: Option<bool>,
    pub sni: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ResponseTlsInfo {
    pub peer_certificate: Option<Vec<u8>>,
    pub peer_certificate_chain: Option<Vec<Vec<u8>>>,
}

#[derive(Debug, Clone)]
pub struct DnsOptions {
    pub doh: Option<String>,
    pub dot: Option<String>,
    pub servers: Vec<String>,
    pub hosts: Vec<(String, Vec<String>)>,
}

#[derive(Debug, Clone)]
pub struct LocalBindOptions {
    pub address: Option<IpAddr>,
    pub ipv4: Option<Ipv4Addr>,
    pub ipv6: Option<Ipv6Addr>,
    pub interface: Option<String>,
}

#[derive(Debug, Clone)]
pub enum PoolIdleTimeout {
    Disabled,
    Millis(u64),
}

#[derive(Debug, Clone)]
pub enum ConnectionGroup {
    Name(String),
    Number(u64),
}

#[derive(Debug)]
pub enum RequestBody {
    Bytes(Vec<u8>),
    Stream {
        receiver: UploadReceiver,
        length: Option<u64>,
    },
    Multipart(MultipartBodyOptions),
}

#[derive(Debug)]
pub struct MultipartBodyOptions {
    pub boundary: String,
    pub parts: Vec<MultipartPartOptions>,
}

#[derive(Debug)]
pub enum MultipartPartOptions {
    Text {
        name: String,
        value: String,
    },
    Stream {
        name: String,
        file_name: String,
        mime_type: String,
        length: u64,
        receiver: UploadReceiver,
    },
}

#[derive(Debug)]
pub struct RequestOptions {
    pub client_id: Option<u64>,
    pub client_cache_key: Option<String>,
    pub url: String,
    pub emulation: Emulation,
    pub headers: Vec<(String, String)>,
    pub orig_headers: Vec<String>,
    pub method: String,
    pub body: Option<RequestBody>,
    pub proxy: Option<String>,
    pub disable_system_proxy: bool,
    pub dns: Option<DnsOptions>,
    pub timeout: Option<u64>,
    pub read_timeout: Option<u64>,
    pub connect_timeout: Option<u64>,
    pub pool_idle_timeout: Option<PoolIdleTimeout>,
    pub pool_max_idle_per_host: Option<usize>,
    pub pool_max_size: Option<usize>,
    pub tls_session_cache_capacity: Option<usize>,
    pub disable_default_headers: bool,
    pub compress: bool,
    pub http1_only: bool,
    pub http2_only: bool,
    pub local_bind: Option<LocalBindOptions>,
    pub tls_identity: Option<TlsIdentityOptions>,
    pub certificate_authority: Option<CertificateAuthorityOptions>,
    pub tls_debug: Option<TlsDebugOptions>,
    pub tls_danger: Option<TlsDangerOptions>,
    pub connection_group: Option<ConnectionGroup>,
    pub forbid_connection_reuse: bool,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body_handle: u64,
    pub cookies: HashMap<String, String>,
    pub set_cookies: Vec<String>,
    pub tls_info: Option<ResponseTlsInfo>,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct WebSocketConnectOptions {
    pub client_id: Option<u64>,
    pub client_cache_key: Option<String>,
    pub url: String,
    pub emulation: Emulation,
    pub headers: Vec<(String, String)>,
    pub orig_headers: Vec<String>,
    pub proxy: Option<String>,
    pub disable_system_proxy: bool,
    pub dns: Option<DnsOptions>,
    pub timeout: Option<u64>,
    pub pool_idle_timeout: Option<PoolIdleTimeout>,
    pub pool_max_idle_per_host: Option<usize>,
    pub pool_max_size: Option<usize>,
    pub tls_session_cache_capacity: Option<usize>,
    pub disable_default_headers: bool,
    pub protocols: Vec<String>,
    pub force_http2: bool,
    pub http_version: Option<wreq::Version>,
    pub read_buffer_size: Option<usize>,
    pub write_buffer_size: Option<usize>,
    pub max_write_buffer_size: Option<usize>,
    pub accept_unmasked_frames: Option<bool>,
    pub max_frame_size: Option<usize>,
    pub max_message_size: Option<usize>,
    pub local_bind: Option<LocalBindOptions>,
    pub tls_identity: Option<TlsIdentityOptions>,
    pub certificate_authority: Option<CertificateAuthorityOptions>,
    pub tls_debug: Option<TlsDebugOptions>,
    pub tls_danger: Option<TlsDangerOptions>,
}

#[derive(Debug, Clone)]
pub struct WebSocketConnection {
    pub handle: u64,
    pub protocol: Option<String>,
    pub extensions: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone)]
pub enum WebSocketReadResult {
    Text(String),
    Binary(Vec<u8>),
    Close {
        code: u16,
        reason: String,
        was_clean: bool,
    },
}
