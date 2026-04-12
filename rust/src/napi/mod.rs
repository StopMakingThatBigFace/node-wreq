mod body;
mod convert;
mod profiles;
mod request;
mod websocket;

use neon::prelude::*;

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    request::register(cx)?;
    body::register(cx)?;
    websocket::register(cx)?;
    profiles::register(cx)?;
    Ok(())
}
