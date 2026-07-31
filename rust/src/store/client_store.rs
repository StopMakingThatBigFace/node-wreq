use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};
use wreq::Client;

type ClientVariants = HashMap<String, Client>;

static CLIENTS: OnceLock<RwLock<HashMap<u64, ClientVariants>>> = OnceLock::new();

fn clients() -> &'static RwLock<HashMap<u64, ClientVariants>> {
    CLIENTS.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn get_client(owner: u64, key: &str) -> Option<Client> {
    clients()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .get(&owner)
        .and_then(|variants| variants.get(key))
        .cloned()
}

pub fn insert_client(owner: u64, key: String, client: Client) -> Client {
    let mut clients = clients().write().unwrap_or_else(|error| error.into_inner());
    let variants = clients.entry(owner).or_default();

    variants.entry(key).or_insert(client).clone()
}

pub fn remove_clients(owner: u64) -> bool {
    clients()
        .write()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&owner)
        .is_some()
}
