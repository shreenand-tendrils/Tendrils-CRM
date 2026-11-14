# Tendrils CRM 4.9.19 (frontend only)
## Tickets page: filters and phone layout
- Views (All / Created by me / Assigned to me / For my team / My tickets & tasks / Unrouted / Overdue) are now one row of pills with counts; on phones the row scrolls sideways instead of wrapping into many lines. All views and counts unchanged.
- Status, priority and team filters sit behind a single **Filters** button on phones (badge shows how many are active) with a **Clear filters** action; on desktop they stay inline as before.
- Summary cards become a compact sideways-scrolling strip on phones.
- Phones always use the card layout (the table turned into a very tall stack of 10+ rows per ticket); the table / card switch stays on desktop. Cards no longer overflow on 320px screens.
- Sort and Filters share one row on phones.
## Copy ticket link
- Every ticket card and table row has a **Copy link** button next to the ticket key (also in the ticket drawer header). It copies `/tickets?ticket=<id>`, which opens that ticket's drawer for anyone signed in with access. The button never opens the ticket, and works on http/older browsers via a fallback.
## Phone shell
- Search folds into an icon in the top bar on phones, so the sticky bar is one row instead of two (a dot shows when a search is active).
No API or database changes.
