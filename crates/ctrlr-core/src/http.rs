//! HTTP(S) transport for JSON-RPC proxies and XML-RPC endpoints.
use crate::rpc::{MAX_RESPONSE, RpcError};

/// Send an RPC body as an HTTP POST and return the reply body, failing on a non-2xx status.
pub async fn request(
    client: &reqwest::Client,
    url: &str,
    body: &[u8],
    content_type: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<Vec<u8>, RpcError> {
    let mut req = client
        .post(url)
        .header("Content-Type", content_type)
        .body(body.to_vec());

    if let Some(user) = username {
        req = req.basic_auth(user, password);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| RpcError::Connection(format!("HTTP request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(RpcError::Connection(format!("HTTP {}", resp.status())));
    }

    if resp.content_length().is_some_and(|n| n > MAX_RESPONSE) {
        return Err(RpcError::too_large());
    }

    // chunked replies carry no Content-Length
    let mut body: Vec<u8> = Vec::new();
    let mut resp = resp;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| RpcError::Connection(format!("failed to read HTTP response: {e}")))?
    {
        if body.len() as u64 + chunk.len() as u64 > MAX_RESPONSE {
            return Err(RpcError::too_large());
        }
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}
