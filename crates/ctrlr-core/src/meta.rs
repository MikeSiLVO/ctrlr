//! Parse .torrent and magnet metadata locally, without involving rTorrent.
use serde::{Deserialize, Serialize};

/// Metadata read from a .torrent file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentMeta {
    pub info_hash: String,
    pub name: String,
    pub total_size: i64,
    pub piece_length: i64,
    pub piece_count: usize,
    pub files: Vec<TorrentMetaFile>,
}

/// One file listed in a .torrent, path joined with slashes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentMetaFile {
    pub path: String,
    pub size: i64,
}

/// Serde view of one file entry in a multi-file info dict.
#[derive(Deserialize)]
struct BencodeFile {
    path: Vec<String>,
    length: i64,
}

/// Serde view of the info dict.
#[derive(Deserialize)]
struct BencodeInfo {
    name: String,
    #[serde(rename = "piece length")]
    piece_length: i64,
    length: Option<i64>,
    files: Option<Vec<BencodeFile>>,
}

/// Serde view of a .torrent's top-level dict.
#[derive(Deserialize)]
struct BencodeTorrent {
    info: BencodeInfo,
}

/// Parse a .torrent file's metadata from raw bytes, rejecting hostile nesting and lengths.
pub fn parse(data: &[u8]) -> Result<TorrentMeta, String> {
    // serde_bencode recurses with no depth limit, and a stack overflow aborts the process
    if skip_bencode_value(data, 0, 0).is_none() {
        return Err("invalid torrent file".into());
    }

    let info_bytes = find_info_value(data)
        .ok_or("failed to locate info dictionary in torrent file")?;
    let info_hash = sha1_smol::Sha1::from(info_bytes).digest().to_string();

    let torrent: BencodeTorrent = serde_bencode::from_bytes(data)
        .map_err(|e| format!("invalid torrent file: {e}"))?;

    let info = &torrent.info;
    let (files, total_size) = match (&info.files, info.length) {
        (Some(file_list), _) => {
            if file_list.iter().any(|f| f.length < 0) {
                return Err("torrent has a negative file length".into());
            }
            let total: i64 = file_list.iter().try_fold(0i64, |a, f| a.checked_add(f.length))
                .ok_or("torrent file lengths overflow")?;
            let files: Vec<TorrentMetaFile> = file_list
                .iter()
                .map(|f| TorrentMetaFile {
                    path: f.path.join("/"),
                    size: f.length,
                })
                .collect();
            (files, total)
        }
        (None, Some(length)) if length >= 0 => {
            let files = vec![TorrentMetaFile {
                path: info.name.clone(),
                size: length,
            }];
            (files, length)
        }
        _ => return Err("torrent has no file information".into()),
    };

    let piece_count = if info.piece_length > 0 {
        (total_size as u64).div_ceil(info.piece_length as u64) as usize
    } else {
        0
    };

    Ok(TorrentMeta {
        info_hash,
        name: info.name.clone(),
        total_size,
        piece_length: info.piece_length,
        piece_count,
        files,
    })
}

/// Parse a magnet URI's btih info hash, hex or base32, into uppercase hex; the key ignores case.
pub fn parse_magnet_hash(uri: &str) -> Option<String> {
    const XT: &str = "xt=urn:btih:";
    for part in uri.split(['?', '&']) {
        let Some(key) = part.get(..XT.len()) else { continue };
        if !key.eq_ignore_ascii_case(XT) {
            continue;
        }
        let hash = &part[XT.len()..];
        if hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(hash.to_uppercase());
        }
        if hash.len() == 32
            && let Ok(bytes) = base32_decode(hash) {
                return Some(bytes.iter().map(|b| format!("{b:02X}")).collect());
            }
    }
    None
}

/// Parse a magnet URI's display name (dn), form-decoded with + as a space.
pub fn parse_magnet_dn(uri: &str) -> Option<String> {
    for part in uri.split('&') {
        let part = part.strip_prefix("magnet:?").unwrap_or(part);
        if let Some(val) = part.strip_prefix("dn=") {
            let name = val.replace('+', " ");
            return Some(urlencoding::decode(&name).map(|n| n.into_owned()).unwrap_or(name));
        }
    }
    None
}

/// Decode unpadded RFC 4648 base32, ignoring case.
fn base32_decode(input: &str) -> Result<Vec<u8>, ()> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let input = input.to_uppercase();
    let mut bits = 0u64;
    let mut bit_count = 0;
    let mut out = Vec::new();
    for ch in input.bytes() {
        let val = alphabet.iter().position(|&c| c == ch).ok_or(())? as u64;
        bits = (bits << 5) | val;
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            out.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }
    Ok(out)
}

/// Find the raw bencoded bytes of the `info` value, which the info hash covers as-is.
fn find_info_value(data: &[u8]) -> Option<&[u8]> {
    if data.first() != Some(&b'd') {
        return None;
    }
    let mut pos = 1;
    while pos < data.len() && data[pos] != b'e' {
        let (key, key_end) = read_bencode_string(data, pos)?;
        pos = key_end;
        let value_start = pos;
        pos = skip_bencode_value(data, pos, 0)?;
        if key == b"info" {
            return Some(&data[value_start..pos]);
        }
    }
    None
}

/// Deepest bencode nesting accepted; real torrents nest a handful of levels.
const MAX_BENCODE_DEPTH: u32 = 32;

/// Read a bencoded byte string, returning it and the offset just past it.
fn read_bencode_string(data: &[u8], pos: usize) -> Option<(&[u8], usize)> {
    let rest = data.get(pos..)?;
    let colon = rest.iter().position(|&b| b == b':')?;
    let len: usize = std::str::from_utf8(rest.get(..colon)?).ok()?.parse().ok()?;
    let start = pos + colon + 1;
    // length comes straight from the file and can overflow
    let end = start.checked_add(len)?;
    if end > data.len() {
        return None;
    }
    Some((&data[start..end], end))
}

/// Skip one bencoded value, returning the offset past it, or None if malformed or too deep.
fn skip_bencode_value(data: &[u8], pos: usize, depth: u32) -> Option<usize> {
    if depth > MAX_BENCODE_DEPTH {
        return None;
    }
    match data.get(pos)? {
        b'd' => {
            let mut p = pos + 1;
            while *data.get(p)? != b'e' {
                let (_, key_end) = read_bencode_string(data, p)?;
                p = skip_bencode_value(data, key_end, depth + 1)?;
            }
            Some(p + 1)
        }
        b'l' => {
            let mut p = pos + 1;
            while *data.get(p)? != b'e' {
                p = skip_bencode_value(data, p, depth + 1)?;
            }
            Some(p + 1)
        }
        b'i' => {
            let end = data[pos + 1..].iter().position(|&b| b == b'e')?;
            Some(pos + 1 + end + 1)
        }
        b'0'..=b'9' => {
            let (_, end) = read_bencode_string(data, pos)?;
            Some(end)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal single-file torrent, 1024 bytes in 512-byte pieces.
    fn single_file_torrent() -> Vec<u8> {
        b"d4:infod6:lengthi1024e4:name8:test.bin12:piece lengthi512eee".to_vec()
    }

    /// Reject 15000 nested lists in a value after the info dict, past where the info lookup stops.
    #[test]
    fn rejects_deep_nesting_after_the_info_value() {
        let mut data = b"d4:infod6:lengthi1024e4:name8:test.bin12:piece lengthi512ee8:url-list".to_vec();
        data.extend(std::iter::repeat_n(b'l', 15_000));
        data.extend(std::iter::repeat_n(b'e', 15_000));
        data.push(b'e');
        assert!(parse(&data).is_err());
    }

    /// Reject a negative length in both the single-file and the multi-file layout.
    #[test]
    fn rejects_negative_lengths() {
        let single = b"d4:infod6:lengthi-1024e4:name1:x12:piece lengthi512eee";
        assert!(parse(single).is_err());
        let multi = b"d4:infod5:filesld6:lengthi-1e4:pathl1:xeee4:name1:d12:piece lengthi512eee";
        assert!(parse(multi).is_err());
    }

    /// Reject rTorrent's session file for a magnet still fetching its metadata.
    #[test]
    fn rejects_magnet_metadata_placeholder() {
        let placeholder = b"d4:infod13:meta_downloadi1e4:name6:AB.meta6:pieces2:xxe10:magnet-uri4:magne";
        assert!(parse(placeholder).is_err());
    }

    /// Parse a 1024-byte single file into 2 pieces of 512 and one file path taken from its name.
    #[test]
    fn parses_single_file() {
        let m = parse(&single_file_torrent()).unwrap();
        assert_eq!(m.name, "test.bin");
        assert_eq!(m.total_size, 1024);
        assert_eq!(m.piece_length, 512);
        assert_eq!(m.piece_count, 2);
        assert_eq!(m.files.len(), 1);
        assert_eq!(m.files[0].path, "test.bin");
        assert_eq!(m.info_hash.len(), 40);
    }

    /// Parse path lists [a, b] and [c] as a/b and c, with sizes summed to 30.
    #[test]
    fn parses_multi_file_paths() {
        let data = b"d4:infod5:filesld6:lengthi10e4:pathl1:a1:beed6:lengthi20e4:pathl1:ceee\
4:name3:dir12:piece lengthi512eee";
        let m = parse(data).unwrap();
        assert_eq!(m.total_size, 30);
        assert_eq!(m.files[0].path, "a/b");
        assert_eq!(m.files[1].path, "c");
    }

    /// Use the info dict's bytes as written for the hash; outer keys change nothing.
    #[test]
    fn info_hash_uses_original_bytes() {
        let a = parse(&single_file_torrent()).unwrap();
        let mut b = b"d4:infod6:lengthi1024e4:name8:test.bin12:piece lengthi512ee7:comment2:hie".to_vec();
        b.shrink_to_fit();
        assert_eq!(a.info_hash, parse(&b).unwrap().info_hash);

        // re-encoding would sort these keys and change the hash
        let info = b"d4:name8:test.bin6:lengthi1024e12:piece lengthi512ee";
        let torrent = [b"d4:info".as_slice(), info, b"e"].concat();
        let expected = sha1_smol::Sha1::from(info.as_slice()).digest().to_string();
        assert_eq!(parse(&torrent).unwrap().info_hash, expected);
    }

    /// Reject 100000 nested lists inside the info value with an error, not a stack overflow.
    #[test]
    fn rejects_deep_nesting_without_overflowing_the_stack() {
        let mut data = b"d4:info".to_vec();
        data.extend(std::iter::repeat_n(b'l', 100_000));
        assert!(parse(&data).is_err());
    }

    /// Reject a u64::MAX string length whose end offset overflows.
    #[test]
    fn rejects_string_length_that_overflows() {
        let data = b"d18446744073709551615:aaaa4:infod4:name1:xeee";
        assert!(parse(data).is_err());
    }

    /// Reject input that ends inside the info dict with both dicts left open.
    #[test]
    fn rejects_unterminated_container() {
        assert!(parse(b"d4:infod6:lengthi1e").is_err());
    }

    /// Reject empty input, plain text, and a bencoded dict without an info key.
    #[test]
    fn rejects_non_torrent_input() {
        assert!(parse(b"").is_err());
        assert!(parse(b"not a torrent").is_err());
        assert!(parse(b"d4:spam4:eggse").is_err());
    }

    /// Parse hex and base32 btih as uppercase hex plus the dn, and no hash from a short one.
    #[test]
    fn parses_magnet_hashes() {
        let hex = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=x";
        assert_eq!(parse_magnet_hash(hex).unwrap(), "0123456789ABCDEF0123456789ABCDEF01234567");
        assert_eq!(parse_magnet_dn(hex).unwrap(), "x");
        let b32 = "magnet:?xt=urn:btih:aebagbafaydqqcikbmga2dqpcaireeyu";
        assert_eq!(parse_magnet_hash(b32).unwrap(), "0102030405060708090A0B0C0D0E0F1011121314");
        assert!(parse_magnet_hash("magnet:?xt=urn:btih:tooshort").is_none());
    }

    /// Match an uppercase XT=URN:BTIH: key, as some clients write it.
    #[test]
    fn magnet_hash_key_ignores_case() {
        let uri = "MAGNET:?XT=URN:BTIH:0123456789ABCDEF0123456789ABCDEF01234567&DN=x";
        assert_eq!(parse_magnet_hash(uri).unwrap(), "0123456789ABCDEF0123456789ABCDEF01234567");
    }

    /// Reject a 40-character btih that is not hex.
    #[test]
    fn rejects_non_hex_40_char_magnet_hash() {
        let uri = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef0123456z";
        assert!(parse_magnet_hash(uri).is_none());
    }

    /// Decode + in a magnet dn as a space and %2B as a literal plus.
    #[test]
    fn magnet_dn_decodes_plus_as_space() {
        let uri = "magnet:?xt=urn:btih:00&dn=Some+Show%2BExtra+S01E01";
        assert_eq!(parse_magnet_dn(uri).unwrap(), "Some Show+Extra S01E01");
    }
}
