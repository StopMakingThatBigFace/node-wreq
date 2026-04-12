use crate::emulation::builders::{build_http1_options, build_http2_options, build_tls_options};
use crate::emulation::payload::CustomEmulationPayload;
use anyhow::{Context, Result};
use wreq::{Emulation as WreqEmulation, EmulationFactory};
use wreq_util::Emulation as BrowserEmulation;

pub fn resolve_emulation(
    browser: BrowserEmulation,
    emulation_json: Option<&str>,
) -> Result<WreqEmulation> {
    let mut emulation = browser.emulation();

    if let Some(emulation_json) = emulation_json {
        let payload = parse_payload(emulation_json)?;
        apply_payload(&mut emulation, payload)?;
    }

    Ok(emulation)
}

fn parse_payload(emulation_json: &str) -> Result<CustomEmulationPayload> {
    serde_json::from_str(emulation_json).context("Failed to parse emulation JSON")
}

fn apply_payload(emulation: &mut WreqEmulation, payload: CustomEmulationPayload) -> Result<()> {
    if let Some(tls_options) = payload.tls_options {
        *emulation.tls_options_mut() = Some(build_tls_options(tls_options)?);
    }

    if let Some(http1_options) = payload.http1_options {
        *emulation.http1_options_mut() = Some(build_http1_options(http1_options)?);
    }

    if let Some(http2_options) = payload.http2_options {
        *emulation.http2_options_mut() = Some(build_http2_options(http2_options)?);
    }

    Ok(())
}
