use crate::emulation::parse::{
    parse_alpn_protocol, parse_alps_protocol, parse_certificate_compression_algorithm,
    parse_http2_setting_id, parse_key_share, parse_pseudo_id, parse_tls_version,
};
use crate::emulation::payload::{
    CustomHttp1Options, CustomHttp2Options, CustomHttp2Priority, CustomTlsOptions,
};
use anyhow::{bail, Result};
use std::collections::HashSet;
use std::time::Duration;
use wreq::{
    http1::Http1Options,
    http2::{
        Http2Options, Priorities, Priority, PseudoOrder, SettingsOrder, StreamDependency, StreamId,
    },
    tls::{ExtensionType, KeyShare, TlsOptions},
};

const DEFAULT_KEY_SHARES: &[KeyShare] =
    &[KeyShare::X25519_MLKEM768, KeyShare::X25519, KeyShare::P256];

pub fn apply_tls_options(mut base: TlsOptions, options: CustomTlsOptions) -> Result<TlsOptions> {
    if options.key_shares.is_some() && options.key_shares_limit.is_some() {
        bail!("Invalid emulation tlsOptions: keyShares and keySharesLimit cannot both be set");
    }

    if let Some(alpn_protocols) = options.alpn_protocols {
        base.alpn_protocols = Some(
            alpn_protocols
                .into_iter()
                .map(|protocol| parse_alpn_protocol(&protocol))
                .collect::<Result<Vec<_>>>()?
                .into(),
        );
    }

    if let Some(alps_protocols) = options.alps_protocols {
        base.alps_protocols = Some(
            alps_protocols
                .into_iter()
                .map(|protocol| parse_alps_protocol(&protocol))
                .collect::<Result<Vec<_>>>()?
                .into(),
        );
    }

    if let Some(value) = options.alps_use_new_codepoint {
        base.alps_use_new_codepoint = value;
    }
    if let Some(value) = options.session_ticket {
        base.session_ticket = value;
    }
    if let Some(value) = options.min_tls_version {
        base.min_tls_version = Some(parse_tls_version(&value)?);
    }
    if let Some(value) = options.max_tls_version {
        base.max_tls_version = Some(parse_tls_version(&value)?);
    }
    if let Some(value) = options.pre_shared_key {
        base.pre_shared_key = value;
    }
    if let Some(value) = options.enable_ech_grease {
        base.enable_ech_grease = value;
    }
    if let Some(value) = options.permute_extensions {
        base.permute_extensions = Some(value);
    }
    if let Some(value) = options.grease_enabled {
        base.grease_enabled = Some(value);
    }
    if let Some(value) = options.enable_ocsp_stapling {
        base.enable_ocsp_stapling = value;
    }
    if let Some(value) = options.enable_signed_cert_timestamps {
        base.enable_signed_cert_timestamps = value;
    }
    if let Some(value) = options.record_size_limit {
        base.record_size_limit = Some(value);
    }
    if let Some(value) = options.psk_skip_session_ticket {
        base.psk_skip_session_ticket = value;
    }
    if let Some(value) = options.key_shares_limit {
        if value == 0 {
            bail!("Invalid emulation tlsOptions.keySharesLimit: must be greater than 0");
        }

        let mut key_shares = base
            .key_shares
            .take()
            .map(|shares| shares.into_owned())
            .unwrap_or_else(|| DEFAULT_KEY_SHARES.to_vec());
        key_shares.truncate(usize::from(value));
        base.key_shares = Some(key_shares.into());
    }
    if let Some(key_shares) = options.key_shares {
        let key_shares = key_shares
            .into_iter()
            .map(|key_share| parse_key_share(&key_share))
            .collect::<Result<Vec<_>>>()?;

        if key_shares.is_empty() {
            bail!("Invalid emulation tlsOptions.keyShares: must not be empty");
        }

        base.key_shares = Some(key_shares.into());
    }
    if let Some(value) = options.psk_dhe_ke {
        base.psk_dhe_ke = value;
    }
    if let Some(value) = options.renegotiation {
        base.renegotiation = value;
    }
    if let Some(value) = options.delegated_credentials {
        base.delegated_credentials = Some(value.into());
    }
    if let Some(value) = options.curves_list {
        base.curves_list = Some(value.into());
    }
    if let Some(value) = options.cipher_list {
        base.cipher_list = Some(value.into());
    }
    if let Some(value) = options.sigalgs_list {
        base.sigalgs_list = Some(value.into());
    }
    if let Some(value) = options.certificate_compression_algorithms {
        base.certificate_compressors = Some(
            value
                .into_iter()
                .map(|algorithm| parse_certificate_compression_algorithm(&algorithm))
                .collect::<Result<Vec<_>>>()?
                .into(),
        );
    }
    if let Some(value) = options.extension_permutation {
        base.extension_permutation = Some(
            value
                .into_iter()
                .map(ExtensionType::from)
                .collect::<Vec<_>>()
                .into(),
        );
    }
    if let Some(value) = options.aes_hw_override {
        base.aes_hw_override = Some(value);
    }
    if let Some(value) = options.preserve_tls13_cipher_list {
        base.preserve_tls13_cipher_list = Some(value);
    }
    if let Some(value) = options.random_aes_hw_override {
        base.random_aes_hw_override = value;
    }

    Ok(base)
}

pub fn apply_http1_options(
    mut base: Http1Options,
    options: CustomHttp1Options,
) -> Result<Http1Options> {
    if let Some(value) = options.http09_responses {
        base.h09_responses = value;
    }
    if let Some(value) = options.writev {
        base.h1_writev = Some(value);
    }
    if let Some(value) = options.max_headers {
        base.h1_max_headers = Some(value);
    }
    if let Some(value) = options.read_buf_exact_size {
        base.h1_read_buf_exact_size = Some(value);
        base.h1_max_buf_size = None;
    }
    if let Some(value) = options.max_buf_size {
        if value < 8192 {
            bail!("Invalid emulation http1Options.maxBufSize: must be at least 8192");
        }
        base.h1_max_buf_size = Some(value);
        base.h1_read_buf_exact_size = None;
    }
    if options.read_buf_exact_size.is_some() && options.max_buf_size.is_some() {
        bail!("Invalid emulation http1Options: readBufExactSize and maxBufSize cannot both be set");
    }
    if let Some(value) = options.ignore_invalid_headers_in_responses {
        base.ignore_invalid_headers_in_responses = value;
    }
    if let Some(value) = options.allow_spaces_after_header_name_in_responses {
        base.allow_spaces_after_header_name_in_responses = value;
    }
    if let Some(value) = options.allow_obsolete_multiline_headers_in_responses {
        base.allow_obsolete_multiline_headers_in_responses = value;
    }

    Ok(base)
}

pub fn apply_http2_options(
    mut base: Http2Options,
    options: CustomHttp2Options,
) -> Result<Http2Options> {
    if let Some(value) = options.adaptive_window {
        base.adaptive_window = value;
    }
    if let Some(value) = options.initial_stream_id {
        base.initial_stream_id = Some(value);
    }
    if let Some(value) = options.initial_connection_window_size {
        base.initial_conn_window_size = value;
        base.adaptive_window = false;
    }
    if let Some(value) = options.initial_window_size {
        base.initial_window_size = value;
        base.adaptive_window = false;
    }
    if let Some(value) = options.initial_max_send_streams {
        base.initial_max_send_streams = value;
    }
    if let Some(value) = options.max_frame_size {
        base.max_frame_size = Some(value);
    }
    if let Some(value) = options.keep_alive_interval {
        base.keep_alive_interval = Some(Duration::from_millis(value));
    }
    if let Some(value) = options.keep_alive_timeout {
        base.keep_alive_timeout = Duration::from_millis(value);
    }
    if let Some(value) = options.keep_alive_while_idle {
        base.keep_alive_while_idle = value;
    }
    if let Some(value) = options.max_concurrent_reset_streams {
        base.max_concurrent_reset_streams = Some(value);
    }
    if let Some(value) = options.max_send_buffer_size {
        if value > u32::MAX as usize {
            bail!("Invalid emulation http2Options.maxSendBufferSize: exceeds u32::MAX");
        }
        base.max_send_buffer_size = value;
    }
    if let Some(value) = options.max_concurrent_streams {
        base.max_concurrent_streams = Some(value);
    }
    if let Some(value) = options.max_header_list_size {
        base.max_header_list_size = Some(value);
    }
    if let Some(value) = options.max_pending_accept_reset_streams {
        base.max_pending_accept_reset_streams = Some(value);
    }
    if let Some(value) = options.enable_push {
        base.enable_push = Some(value);
    }
    if let Some(value) = options.header_table_size {
        base.header_table_size = Some(value);
    }
    if let Some(value) = options.enable_connect_protocol {
        base.enable_connect_protocol = Some(value);
    }
    if let Some(value) = options.no_rfc7540_priorities {
        base.no_rfc7540_priorities = Some(value);
    }
    if let Some(settings_order) = options.settings_order {
        base.settings_order = Some(build_settings_order(settings_order)?);
    }
    if let Some(pseudo_order) = options.headers_pseudo_order {
        base.headers_pseudo_order = Some(build_pseudo_order(pseudo_order)?);
    }
    if let Some(dep) = options.headers_stream_dependency {
        base.headers_stream_dependency = Some(StreamDependency::new(
            StreamId::from(dep.dependency_id),
            dep.weight,
            dep.exclusive,
        ));
    }
    if let Some(priorities) = options.priorities {
        base.priorities = Some(build_priorities(priorities)?);
    }
    if let Some(experimental_settings) = options.experimental_settings {
        if !experimental_settings.is_empty() {
            bail!(
                "Unsupported emulation http2Options.experimentalSettings: wreq 6.0.0-rc.29 no longer exposes custom HTTP/2 settings"
            );
        }
    }

    Ok(base)
}

fn build_pseudo_order(pseudo_order: Vec<String>) -> Result<PseudoOrder> {
    let mut builder = PseudoOrder::builder();
    let mut seen = HashSet::with_capacity(pseudo_order.len());

    for pseudo_id in &pseudo_order {
        let id = parse_pseudo_id(pseudo_id)?;
        if !seen.insert(pseudo_id.clone()) {
            bail!("Duplicate emulation http2Options.headersPseudoOrder entry: {pseudo_id}");
        }
        builder = builder.push(id);
    }

    Ok(builder.build())
}

fn build_settings_order(settings_order: Vec<String>) -> Result<SettingsOrder> {
    let mut builder = SettingsOrder::builder();
    let mut seen = HashSet::with_capacity(settings_order.len());

    for setting in settings_order {
        let setting_id = parse_http2_setting_id(&setting)?;
        if !seen.insert(setting_id) {
            bail!("Duplicate emulation http2Options.settingsOrder entry: {setting}");
        }
        builder = builder.push(setting_id);
    }

    Ok(builder.build())
}

fn build_priorities(priorities: Vec<CustomHttp2Priority>) -> Result<Priorities> {
    let mut builder = Priorities::builder();
    let mut seen_stream_ids = HashSet::with_capacity(priorities.len());

    for priority in priorities {
        if priority.stream_id == 0 {
            bail!(
                "Invalid emulation http2Options.priorities entry: streamId must be greater than 0"
            );
        }
        if !seen_stream_ids.insert(priority.stream_id) {
            bail!(
                "Duplicate emulation http2Options.priorities streamId: {}",
                priority.stream_id
            );
        }

        let dependency = StreamDependency::new(
            StreamId::from(priority.dependency.dependency_id),
            priority.dependency.weight,
            priority.dependency.exclusive,
        );

        builder = builder.push(Priority::new(
            StreamId::from(priority.stream_id),
            dependency,
        ));
    }

    Ok(builder.build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_overrides_preserve_profile_defaults_and_limit_profile_key_shares() {
        let mut base = TlsOptions::default();
        base.session_ticket = false;
        base.key_shares = Some(vec![KeyShare::X25519, KeyShare::P256].into());
        let custom = CustomTlsOptions {
            grease_enabled: Some(true),
            key_shares_limit: Some(1),
            ..Default::default()
        };

        let merged = apply_tls_options(base, custom).expect("TLS options should merge");

        assert!(!merged.session_ticket);
        assert_eq!(merged.grease_enabled, Some(true));
        assert_eq!(
            merged.key_shares.as_deref(),
            Some([KeyShare::X25519].as_slice())
        );
    }

    #[test]
    fn explicit_key_shares_and_limit_are_mutually_exclusive() {
        let custom = CustomTlsOptions {
            key_shares: Some(vec!["X25519".to_string()]),
            key_shares_limit: Some(1),
            ..Default::default()
        };

        let error = apply_tls_options(TlsOptions::default(), custom)
            .expect_err("conflicting key-share options should fail");

        assert!(error.to_string().contains("cannot both be set"));
    }
}
