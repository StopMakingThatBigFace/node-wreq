use crate::napi::convert::{js_object_to_request_options, response_to_js_object};
use crate::store::request_store::{
    cancel_request as cancel_request_handle, insert_request, remove_request,
};
use crate::store::runtime::runtime;
use crate::transport::make_request;
use neon::prelude::*;

fn request(mut cx: FunctionContext) -> JsResult<JsObject> {
    let options_obj = cx.argument::<JsObject>(0)?;
    let options = js_object_to_request_options(&mut cx, options_obj)?;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let handle = insert_request(cancel_tx);

    std::thread::spawn(move || {
        let result = runtime().block_on(async move {
            tokio::select! {
                result = make_request(options) => result,
                _ = cancel_rx => Err(anyhow::anyhow!("Request aborted")),
            }
        });

        remove_request(handle);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(response) => response_to_js_object(&mut cx, response),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    let result = JsObject::new(&mut cx);
    let handle_value = cx.number(handle as f64);

    result.set(&mut cx, "handle", handle_value)?;
    result.set(&mut cx, "promise", promise)?;

    Ok(result)
}

fn cancel_request(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;

    Ok(cx.boolean(cancel_request_handle(handle)))
}

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("request", request)?;
    cx.export_function("cancelRequest", cancel_request)?;
    Ok(())
}
