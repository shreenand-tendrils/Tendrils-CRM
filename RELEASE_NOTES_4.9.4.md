# Tendrils CRM v4.9.4 — Fixed viewport sidebar

- Replaced the desktop sticky sidebar with a fixed viewport sidebar (`position: fixed`, full viewport height).
- The main content remains in the second grid column and scrolls independently.
- Brand and user profile remain anchored; only the navigation region can scroll if it genuinely exceeds the available height.
- Preserved the existing mobile slide-in drawer behavior and explicitly reset the main content to the single mobile grid column.
- No API, database, route, authentication, or permission changes.

Validation: ZIP integrity and source-level CSS checks performed. Full frontend build is not claimed.
