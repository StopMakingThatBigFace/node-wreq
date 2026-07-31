use crate::emulation::builders::{apply_http1_options, apply_http2_options, apply_tls_options};
use crate::emulation::payload::CustomEmulationPayload;
use anyhow::{Context, Result};
use wreq::{Emulation as WreqEmulation, IntoEmulation};
use wreq_util::{Emulation as BrowserEmulation, Platform, Profile};

pub fn resolve_emulation(
    browser: Profile,
    mode: &str,
    platform: Option<&str>,
    http2: Option<bool>,
    headers: Option<bool>,
    emulation_json: Option<&str>,
) -> Result<WreqEmulation> {
    let browser_emulation = match mode {
        "fixed" => BrowserEmulation::builder()
            .profile(browser)
            .platform(parse_platform(platform)?)
            .build(),
        "random" => BrowserEmulation::random(),
        "weighted-random" => BrowserEmulation::weighted_random(),
        other => anyhow::bail!("Invalid browser emulation mode: {other}"),
    };
    let mut emulation = browser_emulation.into_emulation();

    if http2 == Some(false) {
        emulation.http2_options = None;
    }
    if headers == Some(false) {
        emulation.headers.clear();
        emulation.orig_headers = Default::default();
    }

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
        let base = emulation.tls_options.take().unwrap_or_default();
        emulation.tls_options = Some(apply_tls_options(base, tls_options)?);
    }

    if let Some(http1_options) = payload.http1_options {
        let base = emulation.http1_options.take().unwrap_or_default();
        emulation.http1_options = Some(apply_http1_options(base, http1_options)?);
    }

    if let Some(http2_options) = payload.http2_options {
        let base = emulation.http2_options.take().unwrap_or_default();
        emulation.http2_options = Some(apply_http2_options(base, http2_options)?);
    }

    Ok(())
}

fn parse_platform(platform: Option<&str>) -> Result<Platform> {
    match platform.unwrap_or("macos") {
        "windows" => Ok(Platform::Windows),
        "macos" => Ok(Platform::MacOS),
        "linux" => Ok(Platform::Linux),
        "android" => Ok(Platform::Android),
        "ios" => Ok(Platform::IOS),
        other => anyhow::bail!("Invalid browser platform: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_disable_profile_http2_and_headers() {
        let emulation = resolve_emulation(
            Profile::Chrome149,
            "fixed",
            Some("linux"),
            Some(false),
            Some(false),
            None,
        )
        .expect("emulation should resolve");

        assert!(emulation.http2_options.is_none());
        assert!(emulation.headers.is_empty());
        assert!(emulation.orig_headers.is_empty());
        assert!(emulation.tls_options.is_some());
    }
}
