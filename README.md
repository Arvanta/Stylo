# Stylo

![Stylo logo](Source/icon.png)

**Stylo** is a lightweight Firefox extension for writing, managing, and applying custom CSS to websites.

You can now install Stylo directly from the [Mozilla Add-ons Store](https://addons.mozilla.org/en-US/firefox/addon/stylo/)

## Features

- Create styles for a domain, a full URL prefix, or a regular expression.
- Apply global CSS across websites.
- Edit CSS variables alongside each style.
- Enable or disable Stylo and individual styles from the popup.
- Add a style for the currently active website.
- Re-evaluate matching rules after single-page-app URL changes.
- Import and export JSON backups; imports are validated before replacement.
- Search and manage saved targets from the manager.
- Open Global CSS by default; choose a target in the sidebar to edit only that target’s styles.
- Choose Light, Dark, or Auto theme modes.
- Keep one manager tab open and reuse it for requests from the popup.
- Keep unsaved edits when the manager re-renders; prompt before leaving an editing context.

## Installation

1. Download or clone this source repository.
2. Open Firefox and navigate to `about:debugging`.
3. Select **This Firefox**.
4. Click **Load Temporary Add-on**.
5. Select the `manifest.json` file from the project folder.

## Usage

1. Click the Stylo icon in the Firefox toolbar to open the popup.
2. Use the master switch to enable or disable Stylo globally.
3. If the active website has no matching style, click **Add CSS for ...**.
4. Open the manager; it starts on Global CSS. Choose a target from the sidebar to edit styles for that target only.
5. Use the backup controls in the manager to export or import JSON.

## Matching and scope

Domain targets are normalized as hostnames. URL-prefix targets must be full HTTP or HTTPS URLs. Regex targets are length-limited; nested quantified groups, quantified alternations, backreferences, and other common high-cost patterns are conservatively rejected. This is not a formal runtime guarantee for every JavaScript regular expression.

Stylo applies styles in the top-level page context. Iframes are not included. Firefox internal and other restricted pages may also prevent content-script injection.

## Backups

Export saves the data currently stored by Firefox. Manual saves and imports share the same per-style and aggregate size limits; exports are checked to ensure the resulting file fits Stylo's import limits. Import validates the complete file—including targets, variables, size limits, and unique style IDs—before asking for confirmation and replacing the included settings. Unsaved editor drafts are not included in an export.

## Privacy

Stylo has no external service dependency. It does not use a server, CDN, remote JavaScript, remote CSS, or external fonts for its core functionality. Styles and preferences are stored locally in Firefox.

## Development notes

The CSS editor is a lightweight textarea. Full syntax highlighting, autocomplete, and live linting are not included. The extension uses Manifest V2 for Firefox.

## About

Project repository: [github.com/Arvanta/Stylo](https://github.com/Arvanta/Stylo)

## License

Stylo is licensed under the MIT License. See [`LICENSE`](LICENSE).
