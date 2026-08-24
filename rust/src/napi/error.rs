use neon::prelude::*;

fn is_dns_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<wreq::Error>()
            .is_some_and(wreq::Error::is_dns)
    })
}

pub(crate) fn throw_anyhow_error<'a, C, T>(cx: &mut C, error: anyhow::Error) -> JsResult<'a, T>
where
    C: Context<'a>,
    T: Value,
{
    let is_dns = is_dns_error(&error);
    let js_error = JsError::error(cx, format!("{error:#}"))?;

    if is_dns {
        let code = cx.string("ERR_DNS");
        js_error.set(cx, "code", code)?;
    }

    cx.throw(js_error)
}
