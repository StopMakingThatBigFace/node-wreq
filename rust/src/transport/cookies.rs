pub fn parse_cookie_pair(set_cookie: &str) -> Option<(String, String)> {
    let pair = set_cookie.split(';').next()?.trim();
    let (name, value) = pair.split_once('=')?;

    Some((name.to_string(), value.to_string()))
}
