# Stylo

![Stylo logo](icon.png)

**Stylo** is a lightweight Firefox extension for writing, managing, and applying custom CSS to websites.

## Features

- Create custom CSS styles for individual domains.
- Match pages by domain, URL prefix, or regular expression.
- Apply global CSS across websites.
- Enable or disable styles instantly from the popup.
- Add CSS for the currently active website.
- Import and export complete JSON backups.
- Live CSS injection without page reloads.
- Isolated URL-based style targeting.
- Light, dark, and automatic themes.
- Custom delete confirmation dialogs.
- Scrollable domain list with search and clear controls.

## Installation

1. Download or clone this repository.
2. Open Firefox and navigate to `about:debugging`.
3. Select **This Firefox**.
4. Click **Load Temporary Add-on**.
5. Select the `manifest.json` file from the project folder.

## Usage

1. Click the Stylo icon in the Firefox toolbar to open the popup.
2. Use the master switch to enable or disable Stylo globally.
3. If the active website has no style, click **Add CSS for ...**.
4. Use the gear icon to open the management panel.
5. Select a domain from the sidebar to edit its style.
6. Use **Global CSS** for rules that should apply to every website.

## Backup

Use **Export** to save a complete JSON backup containing styles, matching rules, variables, global CSS, and preferences. Use **Import** to restore a backup.

## Privacy

Stylo has no external service dependency. It does not require a server, CDN, remote JavaScript, remote CSS, or external fonts for its core functionality.

## Current editor limitations

The editor currently uses a lightweight textarea. Full syntax highlighting, CSS autocomplete, and real-time CSS linting are planned improvements.

## About

Project repository: [github.com/Arvanta/Stylo](https://github.com/Arvanta/Stylo)

## License

Add the project license that best fits your distribution before publishing the repository.
