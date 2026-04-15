use std::collections::HashMap;
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
pub struct DnsOptions {
    pub servers: Vec<String>,
    pub hosts: Vec<(String, Vec<String>)>,
}

#[derive(Debug, Clone)]
pub struct RequestOptions {
    pub url: String,
    pub emulation: Emulation,
    pub headers: Vec<(String, String)>,
    pub orig_headers: Vec<String>,
    pub method: String,
    pub body: Option<Vec<u8>>,
    pub proxy: Option<String>,
    pub disable_system_proxy: bool,
    pub dns: Option<DnsOptions>,
    pub timeout: Option<u64>,
    pub disable_default_headers: bool,
    pub compress: bool,
    pub tls_identity: Option<TlsIdentityOptions>,
    pub certificate_authority: Option<CertificateAuthorityOptions>,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body_handle: u64,
    pub cookies: HashMap<String, String>,
    pub set_cookies: Vec<String>,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct WebSocketConnectOptions {
    pub url: String,
    pub emulation: Emulation,
    pub headers: Vec<(String, String)>,
    pub orig_headers: Vec<String>,
    pub proxy: Option<String>,
    pub disable_system_proxy: bool,
    pub dns: Option<DnsOptions>,
    pub timeout: Option<u64>,
    pub disable_default_headers: bool,
    pub protocols: Vec<String>,
    pub tls_identity: Option<TlsIdentityOptions>,
    pub certificate_authority: Option<CertificateAuthorityOptions>,
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
