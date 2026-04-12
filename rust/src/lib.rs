mod emulation;
mod napi;
mod store;
mod transport;

use neon::prelude::*;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    napi::register(&mut cx)
}
