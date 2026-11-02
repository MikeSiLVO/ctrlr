//! Abortable handle shared by the RSS and scheduler background loops.

use std::future::Future;

use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// One background loop, never two at once, behind the lock that serializes start and stop.
#[derive(Default)]
pub struct BackgroundLoop {
    task: Mutex<Option<JoinHandle<()>>>,
}

impl BackgroundLoop {
    /// Start the loop unless it is already running; true when this call started it.
    pub async fn start(&self, run: impl Future<Output = ()> + Send + 'static) -> bool {
        let mut task = self.task.lock().await;
        if task.as_ref().is_some_and(|t| !t.is_finished()) {
            return false;
        }
        *task = Some(tokio::spawn(run));
        true
    }

    /// Stop the loop by aborting its task, if it is running.
    pub async fn stop(&self) {
        if let Some(t) = self.task.lock().await.take() {
            t.abort();
        }
    }
}
