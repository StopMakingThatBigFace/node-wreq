use serde::Deserialize;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomEmulationPayload {
    #[serde(default)]
    pub tls_options: Option<CustomTlsOptions>,
    #[serde(default)]
    pub http1_options: Option<CustomHttp1Options>,
    #[serde(default)]
    pub http2_options: Option<CustomHttp2Options>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomTlsOptions {
    #[serde(default)]
    pub alpn_protocols: Option<Vec<String>>,
    #[serde(default)]
    pub alps_protocols: Option<Vec<String>>,
    #[serde(default)]
    pub alps_use_new_codepoint: Option<bool>,
    #[serde(default)]
    pub session_ticket: Option<bool>,
    #[serde(default)]
    pub min_tls_version: Option<String>,
    #[serde(default)]
    pub max_tls_version: Option<String>,
    #[serde(default)]
    pub pre_shared_key: Option<bool>,
    #[serde(default)]
    pub enable_ech_grease: Option<bool>,
    #[serde(default)]
    pub permute_extensions: Option<bool>,
    #[serde(default)]
    pub grease_enabled: Option<bool>,
    #[serde(default)]
    pub enable_ocsp_stapling: Option<bool>,
    #[serde(default)]
    pub enable_signed_cert_timestamps: Option<bool>,
    #[serde(default)]
    pub record_size_limit: Option<u16>,
    #[serde(default)]
    pub psk_skip_session_ticket: Option<bool>,
    #[serde(default)]
    pub key_shares_limit: Option<u8>,
    #[serde(default)]
    pub psk_dhe_ke: Option<bool>,
    #[serde(default)]
    pub renegotiation: Option<bool>,
    #[serde(default)]
    pub delegated_credentials: Option<String>,
    #[serde(default)]
    pub curves_list: Option<String>,
    #[serde(default)]
    pub cipher_list: Option<String>,
    #[serde(default)]
    pub sigalgs_list: Option<String>,
    #[serde(default)]
    pub certificate_compression_algorithms: Option<Vec<String>>,
    #[serde(default)]
    pub extension_permutation: Option<Vec<u16>>,
    #[serde(default)]
    pub aes_hw_override: Option<bool>,
    #[serde(default)]
    pub preserve_tls13_cipher_list: Option<bool>,
    #[serde(default)]
    pub random_aes_hw_override: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomHttp1Options {
    #[serde(default)]
    pub http09_responses: Option<bool>,
    #[serde(default)]
    pub writev: Option<bool>,
    #[serde(default)]
    pub max_headers: Option<usize>,
    #[serde(default)]
    pub read_buf_exact_size: Option<usize>,
    #[serde(default)]
    pub max_buf_size: Option<usize>,
    #[serde(default)]
    pub ignore_invalid_headers_in_responses: Option<bool>,
    #[serde(default)]
    pub allow_spaces_after_header_name_in_responses: Option<bool>,
    #[serde(default)]
    pub allow_obsolete_multiline_headers_in_responses: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomHttp2Options {
    #[serde(default)]
    pub adaptive_window: Option<bool>,
    #[serde(default)]
    pub initial_stream_id: Option<u32>,
    #[serde(default)]
    pub initial_connection_window_size: Option<u32>,
    #[serde(default)]
    pub initial_window_size: Option<u32>,
    #[serde(default)]
    pub initial_max_send_streams: Option<usize>,
    #[serde(default)]
    pub max_frame_size: Option<u32>,
    #[serde(default)]
    pub keep_alive_interval: Option<u64>,
    #[serde(default)]
    pub keep_alive_timeout: Option<u64>,
    #[serde(default)]
    pub keep_alive_while_idle: Option<bool>,
    #[serde(default)]
    pub max_concurrent_reset_streams: Option<usize>,
    #[serde(default)]
    pub max_send_buffer_size: Option<usize>,
    #[serde(default)]
    pub max_concurrent_streams: Option<u32>,
    #[serde(default)]
    pub max_header_list_size: Option<u32>,
    #[serde(default)]
    pub max_pending_accept_reset_streams: Option<usize>,
    #[serde(default)]
    pub enable_push: Option<bool>,
    #[serde(default)]
    pub header_table_size: Option<u32>,
    #[serde(default)]
    pub enable_connect_protocol: Option<bool>,
    #[serde(default)]
    pub no_rfc7540_priorities: Option<bool>,
    #[serde(default)]
    pub settings_order: Option<Vec<String>>,
    #[serde(default)]
    pub headers_pseudo_order: Option<Vec<String>>,
    #[serde(default)]
    pub headers_stream_dependency: Option<CustomHttp2StreamDependency>,
    #[serde(default)]
    pub priorities: Option<Vec<CustomHttp2Priority>>,
    #[serde(default)]
    pub experimental_settings: Option<Vec<CustomHttp2ExperimentalSetting>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomHttp2Priority {
    pub stream_id: u32,
    pub dependency: CustomHttp2StreamDependency,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomHttp2StreamDependency {
    pub dependency_id: u32,
    pub weight: u8,
    #[serde(default)]
    pub exclusive: bool,
}

#[derive(Debug, Deserialize)]
pub struct CustomHttp2ExperimentalSetting {
    pub id: u16,
    pub value: u32,
}
