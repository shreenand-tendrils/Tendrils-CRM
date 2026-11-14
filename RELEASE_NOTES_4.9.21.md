# Tendrils CRM 4.9.21 (frontend only): buttons, ticket window, resources
## Buttons
- Root cause of "buttons stuck together": the `.row` class used around button groups had no CSS. It is now a spaced, wrapping flex row (inline styles on single rows still override it).
- New shared button styles (`btn-soft`, segmented tabs, pills) used on the new screens below.
## Notifications (desktop and phone)
- Unread / All is a segmented control with counts; "Mark all as read" and "Clear read" are proper buttons with icons (stacked 2-up on phones).
- Each notification is a card with an unread tint; "Mark read" is a small button (drops under the text on phones). Repeated items show "x3".
- "Show N more" is a centered pill button (full width on phones), also used in the home Activity feed.
## Ticket window
- "Raised by" and "Created by" were shown 3 times (header strip, side card, Route tab). Now the person who raised it is shown once, in the header strip with avatar and date. The side card keeps Status, Due, Progress, Priority; the Route tab shows Collaborators instead. Same duplicate removed from the task window.
- Title and Copy link / Edit sit in a proper header row; meta strip is a tidy grid; tabs scroll sideways on phones; side-panel save buttons are full width.
## Resources
- Section switcher is a segmented control with icons.
- Documents: drag-and-drop upload card (title, category, visibility), search plus category filters, rows with category/visibility tags and date, Download button.
- Reminders: add form card, Open/Done sections, Overdue marker, Done / Reopen / Delete buttons.
- My notes: note cards with Edit / Delete buttons.
No API or database changes. Behavior of every action is unchanged.
