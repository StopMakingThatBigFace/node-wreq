use anyhow::{bail, Result};
use wreq::{
    http2::{PseudoId, SettingId},
    tls::{AlpnProtocol, AlpsProtocol, CertificateCompressionAlgorithm, TlsVersion},
};

pub fn parse_tls_version(value: &str) -> Result<TlsVersion> {
    match value {
        "1.0" | "TLS1.0" => Ok(TlsVersion::TLS_1_0),
        "1.1" | "TLS1.1" => Ok(TlsVersion::TLS_1_1),
        "1.2" | "TLS1.2" => Ok(TlsVersion::TLS_1_2),
        "1.3" | "TLS1.3" => Ok(TlsVersion::TLS_1_3),
        other => bail!("Invalid TLS version: {other}"),
    }
}

pub fn parse_alpn_protocol(value: &str) -> Result<AlpnProtocol> {
    match value {
        "HTTP1" => Ok(AlpnProtocol::HTTP1),
        "HTTP2" => Ok(AlpnProtocol::HTTP2),
        "HTTP3" => Ok(AlpnProtocol::HTTP3),
        other => bail!("Invalid ALPN protocol: {other}"),
    }
}

pub fn parse_alps_protocol(value: &str) -> Result<AlpsProtocol> {
    match value {
        "HTTP1" => Ok(AlpsProtocol::HTTP1),
        "HTTP2" => Ok(AlpsProtocol::HTTP2),
        "HTTP3" => Ok(AlpsProtocol::HTTP3),
        other => bail!("Invalid ALPS protocol: {other}"),
    }
}

pub fn parse_certificate_compression_algorithm(
    value: &str,
) -> Result<CertificateCompressionAlgorithm> {
    match value {
        "zlib" => Ok(CertificateCompressionAlgorithm::ZLIB),
        "brotli" => Ok(CertificateCompressionAlgorithm::BROTLI),
        "zstd" => Ok(CertificateCompressionAlgorithm::ZSTD),
        other => bail!("Invalid certificate compression algorithm: {other}"),
    }
}

pub fn parse_pseudo_id(value: &str) -> Result<PseudoId> {
    match value {
        "Method" => Ok(PseudoId::Method),
        "Scheme" => Ok(PseudoId::Scheme),
        "Authority" => Ok(PseudoId::Authority),
        "Path" => Ok(PseudoId::Path),
        "Protocol" => Ok(PseudoId::Protocol),
        other => bail!("Invalid HTTP/2 pseudo-header id: {other}"),
    }
}

pub fn parse_http2_setting_id(value: &str) -> Result<SettingId> {
    match value {
        "HeaderTableSize" => Ok(SettingId::HeaderTableSize),
        "EnablePush" => Ok(SettingId::EnablePush),
        "MaxConcurrentStreams" => Ok(SettingId::MaxConcurrentStreams),
        "InitialWindowSize" => Ok(SettingId::InitialWindowSize),
        "MaxFrameSize" => Ok(SettingId::MaxFrameSize),
        "MaxHeaderListSize" => Ok(SettingId::MaxHeaderListSize),
        "EnableConnectProtocol" => Ok(SettingId::EnableConnectProtocol),
        "NoRfc7540Priorities" => Ok(SettingId::NoRfc7540Priorities),
        other => bail!("Invalid HTTP/2 setting id: {other}"),
    }
}
