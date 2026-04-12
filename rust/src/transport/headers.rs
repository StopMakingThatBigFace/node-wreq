use wreq::header::OrigHeaderMap;

pub fn build_orig_header_map(orig_headers: &[String]) -> OrigHeaderMap {
    let mut map = OrigHeaderMap::with_capacity(orig_headers.len());
    for header in orig_headers {
        map.insert(header.clone());
    }
    map
}
