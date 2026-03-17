mod client;

use neon::prelude::*;
use neon::types::buffer::TypedArray;
use neon::types::JsBuffer;
use client::{
    RequestOptions, Response, WebSocketConnectOptions, WebSocketConnection, WebSocketReadResult,
    cancel_body, close_websocket, connect_websocket, execute_request, read_body_all,
    read_body_chunk, read_websocket_message, send_websocket_binary, send_websocket_text,
};
use std::collections::HashMap;
use wreq_util::Emulation;

// Parse browser string to Emulation enum
fn parse_emulation(browser: &str) -> Emulation {
    match browser {
        // Chrome
        "chrome_100" => Emulation::Chrome100,
        "chrome_101" => Emulation::Chrome101,
        "chrome_104" => Emulation::Chrome104,
        "chrome_105" => Emulation::Chrome105,
        "chrome_106" => Emulation::Chrome106,
        "chrome_107" => Emulation::Chrome107,
        "chrome_108" => Emulation::Chrome108,
        "chrome_109" => Emulation::Chrome109,
        "chrome_110" => Emulation::Chrome110,
        "chrome_114" => Emulation::Chrome114,
        "chrome_116" => Emulation::Chrome116,
        "chrome_117" => Emulation::Chrome117,
        "chrome_118" => Emulation::Chrome118,
        "chrome_119" => Emulation::Chrome119,
        "chrome_120" => Emulation::Chrome120,
        "chrome_123" => Emulation::Chrome123,
        "chrome_124" => Emulation::Chrome124,
        "chrome_126" => Emulation::Chrome126,
        "chrome_127" => Emulation::Chrome127,
        "chrome_128" => Emulation::Chrome128,
        "chrome_129" => Emulation::Chrome129,
        "chrome_130" => Emulation::Chrome130,
        "chrome_131" => Emulation::Chrome131,
        "chrome_132" => Emulation::Chrome132,
        "chrome_133" => Emulation::Chrome133,
        "chrome_134" => Emulation::Chrome134,
        "chrome_135" => Emulation::Chrome135,
        "chrome_136" => Emulation::Chrome136,
        "chrome_137" => Emulation::Chrome137,
        // Edge
        "edge_101" => Emulation::Edge101,
        "edge_122" => Emulation::Edge122,
        "edge_127" => Emulation::Edge127,
        "edge_131" => Emulation::Edge131,
        "edge_134" => Emulation::Edge134,
        // Safari
        "safari_ios_17_2" => Emulation::SafariIos17_2,
        "safari_ios_17_4_1" => Emulation::SafariIos17_4_1,
        "safari_ios_16_5" => Emulation::SafariIos16_5,
        "safari_15_3" => Emulation::Safari15_3,
        "safari_15_5" => Emulation::Safari15_5,
        "safari_15_6_1" => Emulation::Safari15_6_1,
        "safari_16" => Emulation::Safari16,
        "safari_16_5" => Emulation::Safari16_5,
        "safari_17_0" => Emulation::Safari17_0,
        "safari_17_2_1" => Emulation::Safari17_2_1,
        "safari_17_4_1" => Emulation::Safari17_4_1,
        "safari_17_5" => Emulation::Safari17_5,
        "safari_18" => Emulation::Safari18,
        "safari_ipad_18" => Emulation::SafariIPad18,
        "safari_18_2" => Emulation::Safari18_2,
        "safari_ios_18_1_1" => Emulation::SafariIos18_1_1,
        "safari_18_3" => Emulation::Safari18_3,
        "safari_18_3_1" => Emulation::Safari18_3_1,
        "safari_18_5" => Emulation::Safari18_5,
        // Firefox
        "firefox_109" => Emulation::Firefox109,
        "firefox_117" => Emulation::Firefox117,
        "firefox_128" => Emulation::Firefox128,
        "firefox_133" => Emulation::Firefox133,
        "firefox_135" => Emulation::Firefox135,
        "firefox_private_135" => Emulation::FirefoxPrivate135,
        "firefox_android_135" => Emulation::FirefoxAndroid135,
        "firefox_136" => Emulation::Firefox136,
        "firefox_private_136" => Emulation::FirefoxPrivate136,
        "firefox_139" => Emulation::Firefox139,
        // Opera
        "opera_116" => Emulation::Opera116,
        "opera_117" => Emulation::Opera117,
        "opera_118" => Emulation::Opera118,
        "opera_119" => Emulation::Opera119,
        // OkHttp
        "okhttp_3_9" => Emulation::OkHttp3_9,
        "okhttp_3_11" => Emulation::OkHttp3_11,
        "okhttp_3_13" => Emulation::OkHttp3_13,
        "okhttp_3_14" => Emulation::OkHttp3_14,
        "okhttp_4_9" => Emulation::OkHttp4_9,
        "okhttp_4_10" => Emulation::OkHttp4_10,
        "okhttp_4_12" => Emulation::OkHttp4_12,
        "okhttp_5" => Emulation::OkHttp5,
        // Default to Chrome 137
        _ => Emulation::Chrome137,
    }
}

// Convert JS object to RequestOptions
fn js_object_to_request_options(cx: &mut FunctionContext, obj: Handle<JsObject>) -> NeonResult<RequestOptions> {
    // Get URL (required)
    let url: Handle<JsString> = obj.get(cx, "url")?;
    let url = url.value(cx);

    // Get browser (optional, defaults to chrome_137)
    let browser_str = obj
        .get_opt(cx, "browser")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "chrome_137".to_string());

    let emulation = parse_emulation(&browser_str);

    // Get method (optional, defaults to GET)
    let method = obj
        .get_opt(cx, "method")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "GET".to_string());

    // Get headers (optional)
    let mut headers = HashMap::new();
    if let Ok(Some(headers_obj)) = obj.get_opt::<JsObject, _, _>(cx, "headers") {
        let keys = headers_obj.get_own_property_names(cx)?;
        let keys_vec = keys.to_vec(cx)?;

        for key_val in keys_vec {
            if let Ok(key_str) = key_val.downcast::<JsString, _>(cx) {
                let key = key_str.value(cx);
                if let Ok(value) = headers_obj.get::<JsString, _, _>(cx, key.as_str()) {
                    headers.insert(key, value.value(cx));
                }
            }
        }
    }

    // Get body (optional)
    let body = obj
        .get_opt(cx, "body")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    // Get proxy (optional)
    let proxy = obj
        .get_opt(cx, "proxy")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    // Get timeout (optional, defaults to 30000ms)
    let timeout = obj
        .get_opt(cx, "timeout")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsNumber, _>(cx).ok())
        .map(|v| v.value(cx) as u64)
        .unwrap_or(30000);

    Ok(RequestOptions {
        url,
        emulation,
        headers,
        method,
        body,
        proxy,
        timeout,
    })
}

fn js_object_to_websocket_options(
    cx: &mut FunctionContext,
    obj: Handle<JsObject>,
) -> NeonResult<WebSocketConnectOptions> {
    let url: Handle<JsString> = obj.get(cx, "url")?;
    let url = url.value(cx);

    let browser_str = obj
        .get_opt(cx, "browser")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx))
        .unwrap_or_else(|| "chrome_137".to_string());

    let emulation = parse_emulation(&browser_str);

    let mut headers = HashMap::new();
    if let Ok(Some(headers_obj)) = obj.get_opt::<JsObject, _, _>(cx, "headers") {
        let keys = headers_obj.get_own_property_names(cx)?;
        let keys_vec = keys.to_vec(cx)?;

        for key_val in keys_vec {
            if let Ok(key_str) = key_val.downcast::<JsString, _>(cx) {
                let key = key_str.value(cx);
                if let Ok(value) = headers_obj.get::<JsString, _, _>(cx, key.as_str()) {
                    headers.insert(key, value.value(cx));
                }
            }
        }
    }

    let proxy = obj
        .get_opt(cx, "proxy")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsString, _>(cx).ok())
        .map(|v| v.value(cx));

    let timeout = obj
        .get_opt(cx, "timeout")?
        .and_then(|v: Handle<JsValue>| v.downcast::<JsNumber, _>(cx).ok())
        .map(|v| v.value(cx) as u64)
        .unwrap_or(30000);

    let mut protocols = Vec::new();
    if let Some(values) = obj.get_opt::<JsArray, _, _>(cx, "protocols")? {
        for value in values.to_vec(cx)? {
            if let Ok(value) = value.downcast::<JsString, _>(cx) {
                protocols.push(value.value(cx));
            }
        }
    }

    Ok(WebSocketConnectOptions {
        url,
        emulation,
        headers,
        proxy,
        timeout,
        protocols,
    })
}

// Convert Response to JS object
fn response_to_js_object<'a, C: Context<'a>>(cx: &mut C, response: Response) -> JsResult<'a, JsObject> {
    let obj = cx.empty_object();

    // Status
    let status = cx.number(response.status as f64);
    obj.set(cx, "status", status)?;

    // URL
    let url = cx.string(&response.url);
    obj.set(cx, "url", url)?;

    // Headers
    let headers_obj = cx.empty_object();
    for (key, value) in response.headers {
        let value_str = cx.string(&value);
        headers_obj.set(cx, key.as_str(), value_str)?;
    }
    obj.set(cx, "headers", headers_obj)?;

    // Cookies
    let cookies_obj = cx.empty_object();
    for (key, value) in response.cookies {
        let value_str = cx.string(&value);
        cookies_obj.set(cx, key.as_str(), value_str)?;
    }
    obj.set(cx, "cookies", cookies_obj)?;

    // Raw Set-Cookie headers
    let set_cookies = JsArray::new(cx, response.set_cookies.len());
    for (index, value) in response.set_cookies.into_iter().enumerate() {
        let value_str = cx.string(&value);
        set_cookies.set(cx, index as u32, value_str)?;
    }
    obj.set(cx, "setCookies", set_cookies)?;

    // Body handle
    let body_handle = cx.number(response.body_handle as f64);
    obj.set(cx, "bodyHandle", body_handle)?;

    Ok(obj)
}

fn websocket_to_js_object<'a, C: Context<'a>>(
    cx: &mut C,
    websocket: WebSocketConnection,
) -> JsResult<'a, JsObject> {
    let obj = cx.empty_object();
    let handle = cx.number(websocket.handle as f64);
    let url = cx.string(&websocket.url);

    obj.set(cx, "handle", handle)?;
    obj.set(cx, "url", url)?;

    match websocket.protocol {
        Some(protocol) => {
            let value = cx.string(protocol);
            obj.set(cx, "protocol", value)?;
        }
        None => {
            let value = cx.null();
            obj.set(cx, "protocol", value)?;
        }
    };

    match websocket.extensions {
        Some(extensions) => {
            let value = cx.string(extensions);
            obj.set(cx, "extensions", value)?;
        }
        None => {
            let value = cx.null();
            obj.set(cx, "extensions", value)?;
        }
    };

    Ok(obj)
}

// Main request function exported to Node.js
fn request(mut cx: FunctionContext) -> JsResult<JsPromise> {
    // Get the options object
    let options_obj = cx.argument::<JsObject>(0)?;

    // Convert JS object to Rust struct
    let options = js_object_to_request_options(&mut cx, options_obj)?;

    // Create a promise
    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    // Create a new Tokio runtime for this request
    std::thread::spawn(move || {
        let result = execute_request(options);

        // Send result back to JS
        deferred.settle_with(&channel, move |mut cx| {
            match result {
                Ok(response) => response_to_js_object(&mut cx, response),
                Err(e) => {
                    // Format error with full chain for better debugging
                    let error_msg = format!("{:#}", e);
                    cx.throw_error(error_msg)
                }
            }
        });
    });

    Ok(promise)
}

fn read_body_chunk_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let size = cx.argument_opt(1)
        .and_then(|value| value.downcast::<JsNumber, _>(&mut cx).ok())
        .map(|value| value.value(&mut cx) as usize)
        .unwrap_or(65_536);

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = read_body_chunk(handle, size);

        deferred.settle_with(&channel, move |mut cx| {
            match result {
                Ok((chunk, done)) => {
                    let obj = cx.empty_object();
                    let chunk_buffer = JsBuffer::from_slice(&mut cx, &chunk)?;
                    let done_value = cx.boolean(done);
                    obj.set(&mut cx, "chunk", chunk_buffer)?;
                    obj.set(&mut cx, "done", done_value)?;
                    Ok(obj)
                }
                Err(error) => cx.throw_error(format!("{:#}", error)),
            }
        });
    });

    Ok(promise)
}

fn read_body_all_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = read_body_all(handle);

        deferred.settle_with(&channel, move |mut cx| {
            match result {
                Ok(bytes) => JsBuffer::from_slice(&mut cx, &bytes),
                Err(error) => cx.throw_error(format!("{:#}", error)),
            }
        });
    });

    Ok(promise)
}

fn cancel_body_js(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let handle = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    Ok(cx.boolean(cancel_body(handle)))
}

fn websocket_connect_js(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let options_obj = cx.argument::<JsObject>(0)?;
    let options = js_object_to_websocket_options(&mut cx, options_obj)?;

    let channel = cx.channel();
    let (deferred, promise) = cx.promise();

    std::thread::spawn(move || {
        let result = connect_websocket(options);

        deferred.settle_with(&channel, move |mut cx| match result {
            Ok(websocket) => websocket_to_js_object(&mut cx, websocket),
            Err(error) => cx.throw_error(format!("{:#}", error)),
        });
    });

    Ok(promise)
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

// Get list of available browser profiles
fn get_profiles(mut cx: FunctionContext) -> JsResult<JsArray> {
    let profiles = vec![
        // Chrome
        "chrome_100", "chrome_101", "chrome_104", "chrome_105", "chrome_106", "chrome_107",
        "chrome_108", "chrome_109", "chrome_110", "chrome_114", "chrome_116", "chrome_117",
        "chrome_118", "chrome_119", "chrome_120", "chrome_123", "chrome_124", "chrome_126",
        "chrome_127", "chrome_128", "chrome_129", "chrome_130", "chrome_131", "chrome_132",
        "chrome_133", "chrome_134", "chrome_135", "chrome_136", "chrome_137",
        // Edge
        "edge_101", "edge_122", "edge_127", "edge_131", "edge_134",
        // Safari
        "safari_ios_17_2", "safari_ios_17_4_1", "safari_ios_16_5",
        "safari_15_3", "safari_15_5", "safari_15_6_1", "safari_16", "safari_16_5",
        "safari_17_0", "safari_17_2_1", "safari_17_4_1", "safari_17_5", "safari_18",
        "safari_ipad_18", "safari_18_2", "safari_ios_18_1_1",
        "safari_18_3", "safari_18_3_1", "safari_18_5",
        // Firefox
        "firefox_109", "firefox_117", "firefox_128", "firefox_133", "firefox_135",
        "firefox_private_135", "firefox_android_135",
        "firefox_136", "firefox_private_136", "firefox_139",
        // Opera
        "opera_116", "opera_117", "opera_118", "opera_119",
        // OkHttp
        "okhttp_3_9", "okhttp_3_11", "okhttp_3_13", "okhttp_3_14",
        "okhttp_4_9", "okhttp_4_10", "okhttp_4_12", "okhttp_5",
    ];

    let js_array = cx.empty_array();

    for (i, profile) in profiles.iter().enumerate() {
        let js_string = cx.string(*profile);
        js_array.set(&mut cx, i as u32, js_string)?;
    }

    Ok(js_array)
}

// Module initialization
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("request", request)?;
    cx.export_function("readBodyChunk", read_body_chunk_js)?;
    cx.export_function("readBodyAll", read_body_all_js)?;
    cx.export_function("cancelBody", cancel_body_js)?;
    cx.export_function("websocketConnect", websocket_connect_js)?;
    cx.export_function("websocketRead", websocket_read_js)?;
    cx.export_function("websocketSendText", websocket_send_text_js)?;
    cx.export_function("websocketSendBinary", websocket_send_binary_js)?;
    cx.export_function("websocketClose", websocket_close_js)?;
    cx.export_function("getProfiles", get_profiles)?;
    Ok(())
}
