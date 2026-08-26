use crate::store::body_store::{cancel_body, forbid_body_recycle, read_body_all, read_body_chunk};
use crate::store::runtime::runtime;
use neon::prelude::*;
use neon::types::JsBuffer;

fn read_body_chunk_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let size = cx
        .argument_opt(1)
        .and_then(|value| value.downcast::<JsNumber, _>(&mut cx).ok())
        .map(|value| value.value(&mut cx) as usize)
        .unwrap_or(65_536);

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    let _body_task = runtime().spawn(async move {
        let result = read_body_chunk(handle, size).await;

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok((chunk, done)) => {
                let obj = cx.empty_object();
                let chunk_buffer = JsBuffer::from_slice(&mut cx, &chunk)?;
                let done_value = cx.boolean(done);
                obj.set(&mut cx, "chunk", chunk_buffer)?;
                obj.set(&mut cx, "done", done_value)?;
                Ok(obj)
            }
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
}

fn cancel_body_js(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    Ok(cx.boolean(cancel_body(handle)))
}

fn read_body_all_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    let _body_task = runtime().spawn(async move {
        let result = read_body_all(handle).await;

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(body) => Ok(JsBuffer::from_slice(&mut cx, &body)?),
            Err(error) => cx.throw_error(format!("{error:#}")),
        });
    });

    Ok(promise)
}

fn forbid_body_recycle_js(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;

    match forbid_body_recycle(handle) {
        Ok(value) => Ok(cx.boolean(value)),
        Err(error) => cx.throw_error(format!("{:#}", error)),
    }
}

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("readBodyChunk", read_body_chunk_js)?;
    cx.export_function("readBodyAll", read_body_all_js)?;
    cx.export_function("cancelBody", cancel_body_js)?;
    cx.export_function("forbidBodyRecycle", forbid_body_recycle_js)?;
    Ok(())
}
