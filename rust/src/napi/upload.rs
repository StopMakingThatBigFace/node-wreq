use crate::store::runtime::runtime;
use crate::store::upload_store::{create_upload, finish_upload, upload_sender};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use neon::types::JsBuffer;
use std::io;

fn parse_upload_handle(cx: &mut FunctionContext, index: usize) -> NeonResult<u64> {
    let value = cx.argument::<JsNumber>(index)?.value(cx);

    if !value.is_finite()
        || value.fract() != 0.0
        || !(0.0..=9_007_199_254_740_991.0).contains(&value)
    {
        return cx.throw_type_error("upload handle must be a non-negative safe integer");
    }

    Ok(value as u64)
}

fn create_upload_js(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let handle = create_upload();
    Ok(cx.number(handle as f64))
}

fn write_upload_chunk_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = parse_upload_handle(&mut cx, 0)?;
    let buffer = cx.argument::<JsBuffer>(1)?;
    let bytes = buffer.as_slice(&cx).to_vec();
    let sender = upload_sender(handle).or_else(|error| cx.throw_error(error.to_string()))?;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    runtime().spawn(async move {
        let result = sender
            .send(Ok(bytes))
            .await
            .map_err(|_| anyhow::anyhow!("Multipart upload stream {handle} was closed"));

        if result.is_err() {
            finish_upload(handle);
        }

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(()) => Ok(cx.undefined()),
            Err(error) => cx.throw_error(error.to_string()),
        });
    });

    Ok(promise)
}

fn fail_upload_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = parse_upload_handle(&mut cx, 0)?;
    let message = cx.argument::<JsString>(1)?.value(&mut cx);
    let sender = upload_sender(handle).or_else(|error| cx.throw_error(error.to_string()))?;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    runtime().spawn(async move {
        let result = sender
            .send(Err(io::Error::other(message)))
            .await
            .map_err(|_| anyhow::anyhow!("Multipart upload stream {handle} was closed"));

        finish_upload(handle);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(()) => Ok(cx.undefined()),
            Err(error) => cx.throw_error(error.to_string()),
        });
    });

    Ok(promise)
}

fn finish_upload_js(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = parse_upload_handle(&mut cx, 0)?;
    Ok(cx.boolean(finish_upload(handle)))
}

pub fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("createUpload", create_upload_js)?;
    cx.export_function("writeUploadChunk", write_upload_chunk_js)?;
    cx.export_function("failUpload", fail_upload_js)?;
    cx.export_function("finishUpload", finish_upload_js)?;
    Ok(())
}
