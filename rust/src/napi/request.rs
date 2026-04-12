use crate::napi::convert::{js_object_to_request_options, response_to_js_object};
use crate::transport::execute_request;
use neon::prelude::*;

fn request(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let options_obj = cx.argument::<JsObject>(0)?;
    let options = js_object_to_request_options(&mut cx, options_obj)?;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = execute_request(options);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(response) => response_to_js_object(&mut cx, response),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
}

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("request", request)?;
    Ok(())
}
