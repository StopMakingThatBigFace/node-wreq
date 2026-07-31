use anyhow::{bail, Result};
use wreq::{
    http2::{PseudoId, SettingId},
    tls::{compress::CertificateCompressor, AlpnProtocol, AlpsProtocol, KeyShare, TlsVersion},
};
use wreq_util::emulate::compress::{BrotliCompressor, ZlibCompressor, ZstdCompressor};

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
) -> Result<&'static dyn CertificateCompressor> {
    match value {
        "zlib" => Ok(&ZlibCompressor),
        "brotli" => Ok(&BrotliCompressor),
        "zstd" => Ok(&ZstdCompressor),
        other => bail!("Invalid certificate compression algorithm: {other}"),
    }
}

pub fn parse_key_share(value: &str) -> Result<KeyShare> {
    match value {
        "P256" => Ok(KeyShare::P256),
        "P384" => Ok(KeyShare::P384),
        "P521" => Ok(KeyShare::P521),
        "X25519" => Ok(KeyShare::X25519),
        "X25519_MLKEM768" => Ok(KeyShare::X25519_MLKEM768),
        "X25519_KYBER768_DRAFT00" => Ok(KeyShare::X25519_KYBER768_DRAFT00),
        "P256_KYBER768_DRAFT00" => Ok(KeyShare::P256_KYBER768_DRAFT00),
        "MLKEM1024" => Ok(KeyShare::MLKEM1024),
        "FFDHE2048" => Ok(KeyShare::FFDHE2048),
        "FFDHE3072" => Ok(KeyShare::FFDHE3072),
        other => bail!("Invalid TLS key share: {other}"),
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
