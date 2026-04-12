use std::collections::HashMap;
use wreq::Emulation;

#[derive(Debug, Clone)]
pub struct RequestOptions {
    pub url: String,
    pub emulation: Emulation,
    pub headers: Vec<(String, String)>,
    pub orig_headers: Vec<String>,
    pub method: String,
    pub body: Option<String>,
    pub proxy: Option<String>,
    pub timeout: u64,
    pub disable_default_headers: bool,
    pub compress: bool,
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
    pub timeout: u64,
    pub disable_default_headers: bool,
    pub protocols: Vec<String>,
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
