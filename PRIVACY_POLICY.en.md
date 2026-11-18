**English** | [繁體中文](PRIVACY_POLICY.md)

# Privacy Policy — Twitch Auto Channel Switcher

Last updated: November 19, 2026

"Twitch Auto Channel Switcher" ("the extension") is a Chrome extension that switches to a chosen streamer's live stream, watches a Drops-enabled stream in a chosen category while that streamer is offline, and claims Drops and channel-point rewards automatically. This policy explains what data the extension accesses, how it is used, and what it does not do.

## Data the extension accesses

- **Twitch login credential (the `auth-token` cookie):** the extension reads the `auth-token` cookie for the twitch.tv domain in your browser to build the authorization header (`Authorization: OAuth <token>`) needed for requests to Twitch.
- **Twitch account status information:** for example whether you are logged in, which channel you are watching, your channel-point balance and claimable bonuses, and your Drops progress and claimable rewards.
- **The extension's own settings and logs:** for example your target streamer, category and toggles, and the local "Reward Claim History" and "Activity Log".

## How the data is used

The data above is used **only to operate Twitch website features on your behalf**:

- To check whether the target streamer is live and whether the channel in your tab is still streaming.
- To check whether Drops or channel-point rewards are claimable, and to claim them by calling the interfaces Twitch uses for this, including internal interfaces that the Twitch website uses but has not publicly documented.
- To keep a local (on your computer) history and statistics of claimed rewards, shown only in the extension's popup.

## Storage and transmission

- All settings and logs are stored **only in your browser's local storage (`chrome.storage.local`)**. Nothing is uploaded to the developer or any third-party server.
- The `auth-token` and the other data above are **only sent from your browser directly to Twitch's official servers** (`gql.twitch.tv`, `www.twitch.tv`) to perform the actions described above.
- The extension **does not** send your login credential, account information or any personal data to the developer, advertisers or any party other than Twitch's official servers.
- The extension contains **no** analytics or tracking and does not collect usage data.

## Your choices and control

- You can turn off auto-claiming or desktop notifications, or disable the whole extension, at any time from the popup.
- Removing the extension deletes all of its locally stored settings and logs.
- You can log out of Twitch or revoke connections in your Twitch account settings at any time to stop the extension from accessing your account.

## Important notice

The extension calls internal interfaces that the Twitch website uses but that are **not documented in Twitch's public technical documentation**. This means:

- These interfaces may change or stop working at any time, which would break auto-claiming.
- Using automation tools with a Twitch account may violate the automation/bot rules in the [Twitch Terms of Service](https://www.twitch.tv/p/en/legal/terms-of-service/). In serious cases Twitch may restrict or suspend accounts. Please weigh the risk yourself before using the extension.

## Contact

If you have any questions about this privacy policy, please open an issue on this project's [GitHub Issues](https://github.com/pajh103082/twitch-auto-switch/issues).

## Changes to this policy

If this policy changes significantly, the "Last updated" date on this page will be updated and the changes described.
