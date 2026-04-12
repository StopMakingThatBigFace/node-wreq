use crate::emulation::parse::{
    parse_alpn_protocol, parse_alps_protocol, parse_certificate_compression_algorithm,
    parse_http2_setting_id, parse_pseudo_id, parse_tls_version,
};
use crate::emulation::payload::{
    CustomHttp1Options, CustomHttp2ExperimentalSetting, CustomHttp2Options, CustomHttp2Priority,
    CustomTlsOptions,
};
use anyhow::{anyhow, bail, Result};
use std::collections::HashSet;
use std::time::Duration;
use wreq::{
    http1::Http1Options,
    http2::{
        ExperimentalSettings, Http2Options, Priorities, Priority, PseudoOrder, Setting, SettingId,
        SettingsOrder, StreamDependency, StreamId,
    },
    tls::{ExtensionType, TlsOptions},
};

pub fn build_tls_options(options: CustomTlsOptions) -> Result<TlsOptions> {
    let mut builder = TlsOptions::builder();

    if let Some(alpn_protocols) = options.alpn_protocols {
        builder = builder.alpn_protocols(
            alpn_protocols
                .into_iter()
                .map(|protocol| parse_alpn_protocol(&protocol))
                .collect::<Result<Vec<_>>>()?,
        );
    }

    if let Some(alps_protocols) = options.alps_protocols {
        builder = builder.alps_protocols(
            alps_protocols
                .into_iter()
                .map(|protocol| parse_alps_protocol(&protocol))
                .collect::<Result<Vec<_>>>()?,
        );
    }

    if let Some(value) = options.alps_use_new_codepoint {
        builder = builder.alps_use_new_codepoint(value);
    }
    if let Some(value) = options.session_ticket {
        builder = builder.session_ticket(value);
    }
    if let Some(value) = options.min_tls_version {
        builder = builder.min_tls_version(Some(parse_tls_version(&value)?));
    }
    if let Some(value) = options.max_tls_version {
        builder = builder.max_tls_version(Some(parse_tls_version(&value)?));
    }
    if let Some(value) = options.pre_shared_key {
        builder = builder.pre_shared_key(value);
    }
    if let Some(value) = options.enable_ech_grease {
        builder = builder.enable_ech_grease(value);
    }
    if let Some(value) = options.permute_extensions {
        builder = builder.permute_extensions(Some(value));
    }
    if let Some(value) = options.grease_enabled {
        builder = builder.grease_enabled(Some(value));
    }
    if let Some(value) = options.enable_ocsp_stapling {
        builder = builder.enable_ocsp_stapling(value);
    }
    if let Some(value) = options.enable_signed_cert_timestamps {
        builder = builder.enable_signed_cert_timestamps(value);
    }
    if let Some(value) = options.record_size_limit {
        builder = builder.record_size_limit(Some(value));
    }
    if let Some(value) = options.psk_skip_session_ticket {
        builder = builder.psk_skip_session_ticket(value);
    }
    if let Some(value) = options.key_shares_limit {
        builder = builder.key_shares_limit(Some(value));
    }
    if let Some(value) = options.psk_dhe_ke {
        builder = builder.psk_dhe_ke(value);
    }
    if let Some(value) = options.renegotiation {
        builder = builder.renegotiation(value);
    }
    if let Some(value) = options.delegated_credentials {
        builder = builder.delegated_credentials(value);
    }
    if let Some(value) = options.curves_list {
        builder = builder.curves_list(value);
    }
    if let Some(value) = options.cipher_list {
        builder = builder.cipher_list(value);
    }
    if let Some(value) = options.sigalgs_list {
        builder = builder.sigalgs_list(value);
    }
    if let Some(value) = options.certificate_compression_algorithms {
        builder = builder.certificate_compression_algorithms(
            value
                .into_iter()
                .map(|algorithm| parse_certificate_compression_algorithm(&algorithm))
                .collect::<Result<Vec<_>>>()?,
        );
    }
    if let Some(value) = options.extension_permutation {
        builder = builder.extension_permutation(
            value
                .into_iter()
                .map(ExtensionType::from)
                .collect::<Vec<_>>(),
        );
    }
    if let Some(value) = options.aes_hw_override {
        builder = builder.aes_hw_override(Some(value));
    }
    if let Some(value) = options.preserve_tls13_cipher_list {
        builder = builder.preserve_tls13_cipher_list(Some(value));
    }
    if let Some(value) = options.random_aes_hw_override {
        builder = builder.random_aes_hw_override(value);
    }

    Ok(builder.build())
}

pub fn build_http1_options(options: CustomHttp1Options) -> Result<Http1Options> {
    let mut builder = Http1Options::builder();

    if let Some(value) = options.http09_responses {
        builder = builder.http09_responses(value);
    }
    if let Some(value) = options.writev {
        builder = builder.writev(Some(value));
    }
    if let Some(value) = options.max_headers {
        builder = builder.max_headers(value);
    }
    if let Some(value) = options.read_buf_exact_size {
        builder = builder.read_buf_exact_size(Some(value));
    }
    if let Some(value) = options.max_buf_size {
        if value < 8192 {
            bail!("Invalid emulation http1Options.maxBufSize: must be at least 8192");
        }
        builder = builder.max_buf_size(value);
    }
    if options.read_buf_exact_size.is_some() && options.max_buf_size.is_some() {
        bail!("Invalid emulation http1Options: readBufExactSize and maxBufSize cannot both be set");
    }
    if let Some(value) = options.ignore_invalid_headers_in_responses {
        builder = builder.ignore_invalid_headers_in_responses(value);
    }
    if let Some(value) = options.allow_spaces_after_header_name_in_responses {
        builder = builder.allow_spaces_after_header_name_in_responses(value);
    }
    if let Some(value) = options.allow_obsolete_multiline_headers_in_responses {
        builder = builder.allow_obsolete_multiline_headers_in_responses(value);
    }

    Ok(builder.build())
}

pub fn build_http2_options(options: CustomHttp2Options) -> Result<Http2Options> {
    let mut builder = Http2Options::builder();

    if let Some(value) = options.adaptive_window {
        builder = builder.adaptive_window(value);
    }
    if let Some(value) = options.initial_stream_id {
        builder = builder.initial_stream_id(Some(value));
    }
    if let Some(value) = options.initial_connection_window_size {
        builder = builder.initial_connection_window_size(Some(value));
    }
    if let Some(value) = options.initial_window_size {
        builder = builder.initial_window_size(Some(value));
    }
    if let Some(value) = options.initial_max_send_streams {
        builder = builder.initial_max_send_streams(Some(value));
    }
    if let Some(value) = options.max_frame_size {
        builder = builder.max_frame_size(Some(value));
    }
    if let Some(value) = options.keep_alive_interval {
        builder = builder.keep_alive_interval(Some(Duration::from_millis(value)));
    }
    if let Some(value) = options.keep_alive_timeout {
        builder = builder.keep_alive_timeout(Duration::from_millis(value));
    }
    if let Some(value) = options.keep_alive_while_idle {
        builder = builder.keep_alive_while_idle(value);
    }
    if let Some(value) = options.max_concurrent_reset_streams {
        builder = builder.max_concurrent_reset_streams(value);
    }
    if let Some(value) = options.max_send_buffer_size {
        builder = builder.max_send_buf_size(value);
    }
    if let Some(value) = options.max_concurrent_streams {
        builder = builder.max_concurrent_streams(Some(value));
    }
    if let Some(value) = options.max_header_list_size {
        builder = builder.max_header_list_size(value);
    }
    if let Some(value) = options.max_pending_accept_reset_streams {
        builder = builder.max_pending_accept_reset_streams(Some(value));
    }
    if let Some(value) = options.enable_push {
        builder = builder.enable_push(value);
    }
    if let Some(value) = options.header_table_size {
        builder = builder.header_table_size(Some(value));
    }
    if let Some(value) = options.enable_connect_protocol {
        builder = builder.enable_connect_protocol(value);
    }
    if let Some(value) = options.no_rfc7540_priorities {
        builder = builder.no_rfc7540_priorities(value);
    }
    if let Some(settings_order) = options.settings_order {
        builder = builder.settings_order(Some(build_settings_order(settings_order)?));
    }
    if let Some(pseudo_order) = options.headers_pseudo_order {
        builder = builder.headers_pseudo_order(Some(build_pseudo_order(pseudo_order)?));
    }
    if let Some(dep) = options.headers_stream_dependency {
        builder = builder.headers_stream_dependency(Some(StreamDependency::new(
            StreamId::from(dep.dependency_id),
            dep.weight,
            dep.exclusive,
        )));
    }
    if let Some(priorities) = options.priorities {
        builder = builder.priorities(Some(build_priorities(priorities)?));
    }
    if let Some(experimental_settings) = options.experimental_settings {
        builder = builder
            .experimental_settings(Some(build_experimental_settings(experimental_settings)?));
    }

    Ok(builder.build())
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
        if !seen.insert(setting_id.clone()) {
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

fn build_experimental_settings(
    experimental_settings: Vec<CustomHttp2ExperimentalSetting>,
) -> Result<ExperimentalSettings> {
    let mut builder = ExperimentalSettings::builder();
    let mut seen_ids = HashSet::with_capacity(experimental_settings.len());
    let max_id = 15u16;

    for setting in experimental_settings {
        if setting.id == 0 || setting.id > max_id {
            bail!(
                "Invalid emulation http2Options.experimentalSettings entry: id must be between 1 and {}",
                max_id
            );
        }
        if !matches!(SettingId::from(setting.id), SettingId::Unknown(_)) {
            bail!(
                "Invalid emulation http2Options.experimentalSettings entry: {} is a standard HTTP/2 setting id",
                setting.id
            );
        }
        if !seen_ids.insert(setting.id) {
            bail!(
                "Duplicate emulation http2Options.experimentalSettings id: {}",
                setting.id
            );
        }

        let setting =
            Setting::from_id(SettingId::Unknown(setting.id), setting.value).ok_or_else(|| {
                anyhow!(
                    "Invalid emulation http2Options.experimentalSettings id: {}",
                    setting.id
                )
            })?;
        builder = builder.push(setting);
    }

    Ok(builder.build())
}
