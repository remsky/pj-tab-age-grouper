# Privacy Policy for PJ Tab Age Grouper

**Last updated:** January 2, 2026

## Overview

PJ Tab Age Grouper is a browser extension that organizes inactive tabs into color-coded groups based on idle time. This privacy policy explains how the extension handles data.

## Data Collection

This extension does **not** collect, store, or transmit any personal information, browsing history, URLs, or website content.

## Data Stored Locally

The extension stores only user preferences using Chrome's built-in storage API:

- Warning threshold setting (minutes)
- Dead threshold setting (minutes)
- Pause/resume state
- UI theme preference

These settings sync across your Chrome browsers if you are signed into Chrome, using Google's sync infrastructure.

## Permissions Used

- **tabs**: Access tab idle time metadata to determine grouping. Does not access URLs, titles, or page content.
- **alarms**: Run periodic checks to organize tabs.
- **tabGroups**: Create and manage tab groups.
- **storage**: Save user preferences.

## Data Sharing

This extension does **not** share any data with third parties.

## Contact

For questions about this privacy policy, open an issue at: https://github.com/remsky/pj-tab-age-grouper
