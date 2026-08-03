use crate::napi::convert::{js_object_to_websocket_options, websocket_to_js_object};
use crate::store::runtime::runtime;
use crate::store::websocket_connect_store::{
    cancel_websocket_connect, insert_websocket_connect, remove_websocket_connect,
};
use crate::store::websocket_store::{
    close_websocket, read_websocket_message, send_websocket_binary, send_websocket_text,
    terminate_websocket,
};
use crate::transport::{make_websocket, types::WebSocketReadResult};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use neon::types::JsBuffer;

fn websocket_connect_js(mut cx: FunctionContext) -> JsResult<JsObject> {
    let options_obj = cx.argument::<JsObject>(0)?;
    let options = js_object_to_websocket_options(&mut cx, options_obj)?;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let handle = insert_websocket_connect(cancel_tx);

    std::thread::spawn(move || {
        let result = runtime().block_on(async move {
            tokio::select! {
                result = make_websocket(options) => result,
                _ = cancel_rx => Err(anyhow::anyhow!("WebSocket connection aborted")),
            }
        });

        remove_websocket_connect(handle);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(websocket) => websocket_to_js_object(&mut cx, websocket),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    let result = JsObject::new(&mut cx);
    let handle_value = cx.number(handle as f64);

    result.set(&mut cx, "handle", handle_value)?;
    result.set(&mut cx, "promise", promise)?;

    Ok(result)
}

fn websocket_cancel_connect_js(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;

    Ok(cx.boolean(cancel_websocket_connect(handle)))
}

fn websocket_read_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = read_websocket_message(handle);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(WebSocketReadResult::Text(text)) => {
                let obj = cx.empty_object();
                let type_value = cx.string("text");
                let data_value = cx.string(text);
                obj.set(&mut cx, "type", type_value)?;
                obj.set(&mut cx, "data", data_value)?;
                Ok(obj)
            }
            Ok(WebSocketReadResult::Binary(bytes)) => {
                let obj = cx.empty_object();
                let type_value = cx.string("binary");
                let data_value = JsBuffer::from_slice(&mut cx, &bytes)?;
                obj.set(&mut cx, "type", type_value)?;
                obj.set(&mut cx, "data", data_value)?;
                Ok(obj)
            }
            Ok(WebSocketReadResult::Close {
                code,
                reason,
                was_clean,
            }) => {
                let obj = cx.empty_object();
                let type_value = cx.string("close");
                let code_value = cx.number(code as f64);
                let reason_value = cx.string(reason);
                let was_clean_value = cx.boolean(was_clean);
                obj.set(&mut cx, "type", type_value)?;
                obj.set(&mut cx, "code", code_value)?;
                obj.set(&mut cx, "reason", reason_value)?;
                obj.set(&mut cx, "wasClean", was_clean_value)?;
                Ok(obj)
            }
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
}

fn websocket_send_text_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let text = cx.argument::<JsString>(1)?.value(&mut cx);

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = send_websocket_text(handle, text);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(()) => Ok(cx.undefined()),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
}

fn websocket_send_binary_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let buffer = cx.argument::<JsBuffer>(1)?;
    let bytes = buffer.as_slice(&cx).to_vec();

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = send_websocket_binary(handle, bytes);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(()) => Ok(cx.undefined()),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
}

fn websocket_close_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let code = cx
        .argument_opt(1)
        .and_then(|value| value.downcast::<JsNumber, _>(&mut cx).ok())
        .map(|value| value.value(&mut cx) as u16);
    let reason = cx
        .argument_opt(2)
        .and_then(|value| value.downcast::<JsString, _>(&mut cx).ok())
        .map(|value| value.value(&mut cx));

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = close_websocket(handle, code, reason);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(()) => Ok(cx.undefined()),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
}

fn websocket_terminate_js(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;

    Ok(cx.boolean(terminate_websocket(handle)))
}

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("websocketConnect", websocket_connect_js)?;
    cx.export_function("websocketCancelConnect", websocket_cancel_connect_js)?;
    cx.export_function("websocketRead", websocket_read_js)?;
    cx.export_function("websocketSendText", websocket_send_text_js)?;
    cx.export_function("websocketSendBinary", websocket_send_binary_js)?;
    cx.export_function("websocketClose", websocket_close_js)?;
    cx.export_function("websocketTerminate", websocket_terminate_js)?;
    Ok(())
}
