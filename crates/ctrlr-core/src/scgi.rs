//! SCGI transport to rTorrent over Unix sockets, TCP and SSH channels.
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::time::timeout;

use crate::rpc::{MAX_RESPONSE, RpcError};

/// Time limit on one connect or request; rTorrent answers in milliseconds.
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Encode a request body into an SCGI frame.
fn encode_frame(content_type: &str, body: &[u8]) -> Vec<u8> {
    let header = format!(
        "CONTENT_LENGTH\x00{}\x00CONTENT_TYPE\x00{}\x00SCGI\x001\x00",
        body.len(),
        content_type,
    );
    let mut frame = format!("{}:{},", header.len(), header).into_bytes();
    frame.extend_from_slice(body);
    frame
}

/// Parse an SCGI response into its body, failing on a non-2xx Status header.
fn parse_response(raw: &[u8]) -> Result<&[u8], RpcError> {
    let pos = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or_else(|| {
        RpcError::Protocol("missing header/body separator in SCGI response".into())
    })?;
    let headers = String::from_utf8_lossy(&raw[..pos]);
    // CGI omits Status for 200
    let status = headers.lines().find_map(|l| l.strip_prefix("Status:")).map(str::trim);
    if let Some(status) = status
        && !status.starts_with('2')
    {
        return Err(RpcError::Protocol(format!("SCGI status {status}")));
    }
    Ok(&raw[pos + 4..])
}

/// Send an SCGI request over an open stream within IO_TIMEOUT and return the response body.
pub async fn send_scgi<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S, content_type: &str, body: &[u8],
) -> Result<Vec<u8>, RpcError> {
    timeout(IO_TIMEOUT, send_scgi_inner(stream, content_type, body))
        .await
        .map_err(|_| RpcError::Connection("request timed out".into()))?
}

/// Send an SCGI request with no time limit, reading at most MAX_RESPONSE bytes back.
async fn send_scgi_inner<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    content_type: &str,
    body: &[u8],
) -> Result<Vec<u8>, RpcError> {
    let frame = encode_frame(content_type, body);
    stream
        .write_all(&frame)
        .await
        .map_err(|e| RpcError::Connection(e.to_string()))?;
    stream
        .shutdown()
        .await
        .map_err(|e| RpcError::Connection(e.to_string()))?;

    let mut response = Vec::new();
    // extra byte tells an oversize reply from one exactly at the cap
    stream
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut response)
        .await
        .map_err(|e| RpcError::Connection(e.to_string()))?;
    if response.len() as u64 > MAX_RESPONSE {
        return Err(RpcError::too_large());
    }

    parse_response(&response).map(|body| body.to_vec())
}

/// Send a raw request over a Unix domain socket and return the response body.
#[cfg(unix)]
pub async fn request_unix(socket_path: &std::path::Path, content_type: &str, body: &[u8]) -> Result<Vec<u8>, RpcError> {
    let stream = timeout(IO_TIMEOUT, tokio::net::UnixStream::connect(socket_path))
        .await
        .map_err(|_| RpcError::Connection("connection timed out".into()))?
        .map_err(|e| RpcError::Connection(e.to_string()))?;
    send_scgi(stream, content_type, body).await
}

/// Send a raw request over a Unix domain socket; always fails on Windows.
#[cfg(not(unix))]
pub async fn request_unix(_socket_path: &std::path::Path, _content_type: &str, _body: &[u8]) -> Result<Vec<u8>, RpcError> {
    Err(RpcError::Connection("Unix sockets are not supported on Windows".into()))
}

/// Send a raw request over a TCP connection and return the response body.
pub async fn request_tcp(host: &str, port: u16, content_type: &str, body: &[u8]) -> Result<Vec<u8>, RpcError> {
    let stream = timeout(IO_TIMEOUT, tokio::net::TcpStream::connect((host, port)))
        .await
        .map_err(|_| RpcError::Connection("connection timed out".into()))?
        .map_err(|e| RpcError::Connection(e.to_string()))?;
    send_scgi(stream, content_type, body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encode a frame as CONTENT_LENGTH and CONTENT_TYPE headers followed by the body.
    #[test]
    fn test_encode_frame() {
        let body = b"test body";
        let frame = encode_frame("text/xml", body);
        let frame_str = String::from_utf8(frame).unwrap();
        assert!(frame_str.contains("CONTENT_LENGTH\x009\x00"));
        assert!(frame_str.contains("CONTENT_TYPE\x00text/xml\x00"));
        assert!(frame_str.ends_with("test body"));
    }

    /// Return the body for a 200 or a missing Status, and fail on a 500 with its status text.
    #[test]
    fn test_parse_response_status() {
        assert_eq!(parse_response(b"Status: 200 OK\r\nContent-Type: text/xml\r\n\r\nok").unwrap(), b"ok");
        assert_eq!(parse_response(b"Content-Type: text/xml\r\n\r\nok").unwrap(), b"ok");
        let err = parse_response(b"Status: 500 Internal Server Error\r\n\r\noops").unwrap_err();
        assert!(err.to_string().contains("500 Internal Server Error"));
    }
}
