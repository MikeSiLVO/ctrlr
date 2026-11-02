//! Parse show, season, episode, quality and source from release titles.
use regex::Regex;
use std::sync::LazyLock;

/// Show, season and episode parsed from a release title.
#[derive(Debug, Clone, PartialEq)]
pub struct EpisodeInfo {
    pub show_name: String,
    pub season: u32,
    pub episode: u32,
    /// Second episode or range end of a multi-episode release, 3 for S01E02E03.
    pub episode_end: Option<u32>,
    /// Resolution in lowercase, with 4K and UHD as 2160p.
    pub quality: Option<String>,
    pub source: Option<String>,
    /// True when parsed from an air date; season then holds YYYYMM and episode the day.
    pub date_based: bool,
}

/// Match S01E02, S01E02E03, S01E02-E03 and S01E02-03.
static RE_SXXEXX: LazyLock<Regex> = LazyLock::new(|| {
    // bare -NN range must end at a boundary; S01E01-2160p is not episodes 1 to 216
    Regex::new(r"(?i)S(\d{1,2})E(\d{1,3})(?:[-.]E(\d{1,3})|E(\d{1,3})|-(\d{1,3})(?:[^0-9a-z]|$))?").unwrap()
});

/// Match 1x02 between non-alphanumerics, never inside a resolution like 1920x1080.
static RE_CROSS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^0-9a-z])(\d{1,2})x(\d{1,3})(?:[^0-9a-z]|$)").unwrap());

/// Match an air date as 2024.01.15 or 2024-01-15.
static RE_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d{4})[.\-](\d{2})[.\-](\d{2})").unwrap());

/// Match a resolution tag, 4K and UHD included.
static RE_QUALITY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(2160p|1080p|720p|480p|4K|UHD)").unwrap()
});

/// Match a release source tag such as WEB-DL or BluRay.
static RE_SOURCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(WEB-DL|WEBRip|BluRay|BDRip|HDRip|HDTV|WEB)").unwrap()
});

/// Extract the show name from the title text before the episode marker, separators as spaces.
fn extract_show_name(title: &str, marker_start: usize) -> String {
    let prefix = &title[..marker_start];
    prefix
        .replace(['.', '_'], " ")
        .replace('-', " ")
        .trim()
        .to_string()
}

/// Extract the resolution tag in lowercase, with 4K and UHD as 2160p.
fn extract_quality(title: &str) -> Option<String> {
    RE_QUALITY.captures(title).map(|c| {
        let q = c[1].to_uppercase();
        match q.as_str() {
            "4K" | "UHD" => "2160p".to_string(),
            _ => q.to_lowercase(),
        }
    })
}

/// Extract the release source tag as written in the title.
fn extract_source(title: &str) -> Option<String> {
    RE_SOURCE.captures(title).map(|c| c[1].to_string())
}

/// Parse episode info from a release title, trying S01E02, then 1x02, then an air date.
pub fn parse_episode(title: &str) -> Option<EpisodeInfo> {
    if let Some(caps) = RE_SXXEXX.captures(title) {
        let season: u32 = caps[1].parse().ok()?;
        let episode: u32 = caps[2].parse().ok()?;
        let episode_end: Option<u32> = caps
            .get(3)
            .or_else(|| caps.get(4))
            .or_else(|| caps.get(5))
            .and_then(|m| m.as_str().parse().ok());
        let show_name = extract_show_name(title, caps.get(0)?.start());
        return Some(EpisodeInfo {
            show_name,
            season,
            episode,
            episode_end,
            quality: extract_quality(title),
            source: extract_source(title),
            date_based: false,
        });
    }

    if let Some(caps) = RE_CROSS.captures(title) {
        let season: u32 = caps[1].parse().ok()?;
        let episode: u32 = caps[2].parse().ok()?;
        let show_name = extract_show_name(title, caps.get(0)?.start());
        return Some(EpisodeInfo {
            show_name,
            season,
            episode,
            episode_end: None,
            quality: extract_quality(title),
            source: extract_source(title),
            date_based: false,
        });
    }

    if let Some(caps) = RE_DATE.captures(title) {
        let year: u32 = caps[1].parse().ok()?;
        let month: u32 = caps[2].parse().ok()?;
        let day: u32 = caps[3].parse().ok()?;
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        let show_name = extract_show_name(title, caps.get(0)?.start());
        return Some(EpisodeInfo {
            show_name,
            season: year * 100 + month,
            episode: day,
            episode_end: None,
            quality: extract_quality(title),
            source: extract_source(title),
            date_based: true,
        });
    }

    None
}

/// Rank of a quality in the preference list, 0 is most preferred, None when absent.
pub fn quality_rank(quality: &str, preferences: &[String]) -> Option<usize> {
    let q = quality.to_lowercase();
    preferences.iter().position(|p| p.to_lowercase() == q)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Breaking.Bad.S01E02.1080p.WEB-DL reads as Breaking Bad season 1 episode 2, 1080p, WEB-DL.
    #[test]
    fn test_sxxexx() {
        let info = parse_episode("Breaking.Bad.S01E02.1080p.WEB-DL").unwrap();
        assert_eq!(info.show_name, "Breaking Bad");
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 2);
        assert_eq!(info.episode_end, None);
        assert_eq!(info.quality.as_deref(), Some("1080p"));
        assert_eq!(info.source.as_deref(), Some("WEB-DL"));
    }

    /// Show.Name.S02E03E04 reads as season 2, episodes 3 to 4.
    #[test]
    fn test_multi_episode() {
        let info = parse_episode("Show.Name.S02E03E04.720p.HDTV").unwrap();
        assert_eq!(info.season, 2);
        assert_eq!(info.episode, 3);
        assert_eq!(info.episode_end, Some(4));
    }

    /// Show.Name.S01E05-E07 reads as episodes 5 to 7.
    #[test]
    fn test_range_episode() {
        let info = parse_episode("Show.Name.S01E05-E07.BluRay").unwrap();
        assert_eq!(info.episode, 5);
        assert_eq!(info.episode_end, Some(7));
    }

    /// Show_Name_1x03_720p reads as Show Name season 1 episode 3 at 720p.
    #[test]
    fn test_cross_pattern() {
        let info = parse_episode("Show_Name_1x03_720p").unwrap();
        assert_eq!(info.show_name, "Show Name");
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 3);
        assert_eq!(info.quality.as_deref(), Some("720p"));
    }

    /// Daily.Show.2024.01.15 reads as a dated episode with season 202401 and episode 15.
    #[test]
    fn test_date_based() {
        let info = parse_episode("Daily.Show.2024.01.15.720p.WEB").unwrap();
        assert!(info.date_based);
        assert_eq!(info.show_name, "Daily Show");
        assert_eq!(info.season, 202401);
        assert_eq!(info.episode, 15);
    }

    /// Movie.S01E01.4K.WEB-DL reads as quality 2160p.
    #[test]
    fn test_4k_normalization() {
        let info = parse_episode("Movie.S01E01.4K.WEB-DL").unwrap();
        assert_eq!(info.quality.as_deref(), Some("2160p"));
    }

    /// Show.Name.1920x1080 reads as no episode; Show.Name.1x02.1080p as season 1 episode 2.
    #[test]
    fn resolution_is_not_an_episode() {
        assert!(parse_episode("Show.Name.1920x1080.WEB-DL").is_none());
        let e = parse_episode("Show.Name.1x02.1080p").unwrap();
        assert_eq!((e.season, e.episode), (1, 2));
    }

    /// A bare range needs a boundary: S01E02-03 ends at 3, S01E01-2160p stays episode 1.
    #[test]
    fn bare_range_needs_a_boundary() {
        let e = parse_episode("Show.S01E02-03.1080p.WEB").unwrap();
        assert_eq!(e.episode_end, Some(3));
        let e = parse_episode("Show.S01E01-2160p.WEB").unwrap();
        assert_eq!((e.episode, e.episode_end), (1, None));
    }

    /// Ubuntu 24.04 Desktop amd64 reads as no episode despite its version number.
    #[test]
    fn test_no_match() {
        assert!(parse_episode("Ubuntu 24.04 Desktop amd64").is_none());
    }

    /// Rank a quality by its index in the preference list, none when it is absent.
    #[test]
    fn test_quality_rank() {
        let prefs = vec!["1080p".into(), "720p".into(), "480p".into()];
        assert_eq!(quality_rank("1080p", &prefs), Some(0));
        assert_eq!(quality_rank("720p", &prefs), Some(1));
        assert_eq!(quality_rank("2160p", &prefs), None);
    }
}
