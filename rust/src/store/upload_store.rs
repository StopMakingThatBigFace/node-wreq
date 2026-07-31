use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::io;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use tokio::sync::mpsc;

const UPLOAD_BUFFERED_CHUNKS: usize = 2;

pub type UploadChunk = Result<Vec<u8>, io::Error>;
pub type UploadReceiver = mpsc::Receiver<UploadChunk>;

struct UploadStream {
    sender: mpsc::Sender<UploadChunk>,
    receiver: Option<UploadReceiver>,
}

static NEXT_UPLOAD_HANDLE: AtomicU64 = AtomicU64::new(1);
static UPLOAD_STORE: OnceLock<Mutex<HashMap<u64, UploadStream>>> = OnceLock::new();

fn upload_store() -> &'static Mutex<HashMap<u64, UploadStream>> {
    UPLOAD_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn create_upload() -> u64 {
    let handle = NEXT_UPLOAD_HANDLE.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel(UPLOAD_BUFFERED_CHUNKS);

    upload_store()
        .lock()
        .expect("upload store poisoned")
        .insert(
            handle,
            UploadStream {
                sender,
                receiver: Some(receiver),
            },
        );

    handle
}

pub fn take_upload_receiver(handle: u64) -> Result<UploadReceiver> {
    upload_store()
        .lock()
        .expect("upload store poisoned")
        .get_mut(&handle)
        .ok_or_else(|| anyhow!("Unknown multipart upload stream: {handle}"))?
        .receiver
        .take()
        .ok_or_else(|| anyhow!("Multipart upload stream {handle} is already attached"))
}

pub fn upload_sender(handle: u64) -> Result<mpsc::Sender<UploadChunk>> {
    upload_store()
        .lock()
        .expect("upload store poisoned")
        .get(&handle)
        .map(|stream| stream.sender.clone())
        .ok_or_else(|| anyhow!("Unknown multipart upload stream: {handle}"))
}

pub fn finish_upload(handle: u64) -> bool {
    upload_store()
        .lock()
        .expect("upload store poisoned")
        .remove(&handle)
        .is_some()
}
