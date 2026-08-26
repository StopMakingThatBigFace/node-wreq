mod body;
mod convert;
mod error;
mod profiles;
mod request;
mod upload;
mod websocket;

use neon::prelude::*;

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    request::register(cx)?;
    upload::register(cx)?;
    body::register(cx)?;
    websocket::register(cx)?;
    profiles::register(cx)?;
    Ok(())
}
