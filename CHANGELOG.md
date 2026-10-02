# Changelog

All notable changes to this project will be documented in this file.

## [v0.2.0] - 2026-10-02

### Fixed
- Fixed card hover flickering when media state updates arrive during hover transition
- Improved SoundCloud media detection and filtered out MediaStream-only elements (Bug 1 & 4)
- Ignore voice-chat / conferencing sites (Slack, Teams, Meet, Zoom) from media detection (Bug 4)
- Lowered `strict_min_version` to 109.0 for broader Firefox and Firefox ESR compatibility
- Added explicit `content_security_policy` for extension pages to ensure reliable resource loading

### Changed
- Sort order of session cards is now managed via CSS `flexbox order` instead of DOM moves, preventing transition interruptions

## [v0.1.0] - 2025-12-23

### Added
- Initial release
- Centralized media control popup for all tabs
- Play/pause, seek ±10s, scrubber bar, volume/mute controls
- Keyboard shortcuts: Ctrl+Shift+Space (play/pause), Ctrl+Shift+, / Ctrl+Shift+. (seek)
- Multi-tab support with automatic audible tab detection
- Works with YouTube, YouTube Music, Spotify Web, SoundCloud, and any HTML5 media
- Firefox Manifest V3 compatibility
