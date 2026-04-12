use neon::prelude::*;
use std::collections::HashMap;
use std::sync::OnceLock;
use strum::VariantArray;
use wreq_util::Emulation as BrowserEmulation;

static PROFILE_NAMES: OnceLock<Vec<String>> = OnceLock::new();
static PROFILE_MAP: OnceLock<HashMap<String, BrowserEmulation>> = OnceLock::new();

fn serialize_emulation_name(emulation: BrowserEmulation) -> String {
    serde_json::to_string(&emulation)
        .expect("failed to serialize emulation profile")
        .trim_matches('"')
        .replace('.', "_")
}

fn profile_names() -> &'static Vec<String> {
    PROFILE_NAMES.get_or_init(|| {
        BrowserEmulation::VARIANTS
            .iter()
            .map(|emulation| serialize_emulation_name(*emulation))
            .collect()
    })
}

fn profile_map() -> &'static HashMap<String, BrowserEmulation> {
    PROFILE_MAP.get_or_init(|| {
        BrowserEmulation::VARIANTS
            .iter()
            .map(|emulation| (serialize_emulation_name(*emulation), *emulation))
            .collect()
    })
}

pub(crate) fn parse_browser_emulation(browser: &str) -> BrowserEmulation {
    profile_map()
        .get(browser)
        .copied()
        .unwrap_or(BrowserEmulation::Chrome137)
}

fn get_profiles(mut cx: FunctionContext) -> JsResult<JsArray> {
    let js_array = cx.empty_array();

    for (i, profile) in profile_names().iter().enumerate() {
        let js_string = cx.string(profile);
        js_array.set(&mut cx, i as u32, js_string)?;
    }

    Ok(js_array)
}

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("getProfiles", get_profiles)?;
    Ok(())
}
