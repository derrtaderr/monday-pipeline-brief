# Changelog

## 0.1.1

- **Stale check on portals with little logged activity.** A deal with no logged activity is now flagged only once it is 14 or more days old, judged by its creation date (`createdate`), and the brief says "no activity logged since it was created Sep 20". Before, every deal with no logged activity was flagged, including deals created that day, and those flags also filled "Look at these first". An empty Next step is still flagged at any age.
- **Service keys.** New HubSpot accounts offer service keys instead of private apps. A service key works unchanged; the quickstart now leads with it and keeps a short private app path for older accounts. Messages now say "service key or private app token".
- Snapshots store each deal's creation date. Snapshots written by 0.1.0 still load as the comparison baseline.
- Run on one real HubSpot portal (custom pipeline, service key, test data).

## 0.1.0

- First release. Weekly HubSpot deal snapshots on your own disk, compared week over week into a markdown brief: open pipeline total and change, won and lost, slipped close dates, stage moves, no next step or no recent activity, new deals, and the deals with more than one warning. Optional Slack post. Zero dependencies.
