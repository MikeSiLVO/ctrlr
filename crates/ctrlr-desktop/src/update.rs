//! Update check against the latest GitHub release.

use std::sync::LazyLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// GitHub API endpoint for the newest published release.
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/MikeSiLVO/ctrlr/releases/latest";

/// A release newer than the running build.
#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

/// The fields read from GitHub's release JSON.
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
}

/// HTTP client for the release lookup; GitHub's API refuses requests without a user agent.
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("ctrlr/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
});

/// Check GitHub for a release newer than the given version, None when there is none.
pub async fn check(current: &semver::Version) -> Result<Option<UpdateInfo>, String> {
    let resp = CLIENT
        .get(LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("HTTP error: {e}"))?;
    let bytes = resp.bytes().await.map_err(|e| format!("read error: {e}"))?;
    let release: Release = serde_json::from_slice(&bytes).map_err(|e| format!("parse error: {e}"))?;
    newer(&release, current)
}

/// The release as an update when its tag is a higher version than the given one.
fn newer(release: &Release, current: &semver::Version) -> Result<Option<UpdateInfo>, String> {
    let tag = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);
    let version = semver::Version::parse(tag).map_err(|e| format!("bad release tag {tag}: {e}"))?;
    Ok((version > *current).then(|| UpdateInfo {
        version: version.to_string(),
        url: release.html_url.clone(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Release with the given tag and a placeholder page.
    fn release(tag: &str) -> Release {
        Release { tag_name: tag.into(), html_url: format!("https://example.com/{tag}") }
    }

    /// Version offered for a latest-release tag against a running version.
    fn offered(tag: &str, current: &str) -> Option<String> {
        let current = semver::Version::parse(current).unwrap();
        newer(&release(tag), &current).unwrap().map(|u| u.version)
    }

    /// Offer a higher version, with or without the v prefix.
    #[test]
    fn offers_a_higher_version() {
        assert_eq!(offered("v1.2.1", "1.2.0").as_deref(), Some("1.2.1"));
        assert_eq!(offered("1.3.0", "1.2.9").as_deref(), Some("1.3.0"));
    }

    /// Skip the running version and any older one.
    #[test]
    fn skips_same_or_older() {
        assert_eq!(offered("v1.2.0", "1.2.0"), None);
        assert_eq!(offered("v1.1.1", "1.2.0"), None);
    }

    /// Rank a final release above its betas, whichever one is running.
    #[test]
    fn ranks_final_above_its_beta() {
        assert_eq!(offered("v1.2.0", "1.2.0-beta.1").as_deref(), Some("1.2.0"));
        assert_eq!(offered("v1.2.0-beta.2", "1.2.0"), None);
    }

    /// Reject a tag that is not a version.
    #[test]
    fn rejects_a_non_version_tag() {
        let current = semver::Version::parse("1.2.0").unwrap();
        assert!(newer(&release("latest"), &current).is_err());
    }
}
