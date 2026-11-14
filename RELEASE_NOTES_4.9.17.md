# Tendrils CRM 4.9.17
## Broadcast / ping (top bar megaphone, next to the bell)
- Send a message to Everyone (admins only), to one or more Teams, or to specific People (filter by team, search by name; teams + people can be mixed). Delivered as in-app notification + email (optional checkbox) + WhatsApp for linked numbers. Urgent flag. 20 messages/hour/person spam guard.
- API: POST /api/v1/broadcasts. New permissions: broadcast.send (Employee + Admin), broadcast.all (Admin). No database changes.
## Guide (top bar book icon, after the bell/megaphone)
- /guide: searchable, detailed guide to every feature (sign-in modes and roles, tickets, review flow, tasks, teams/routing, projects, chat, resources, notifications/email/WhatsApp, broadcast, settings, admin, links/attachments, tips, troubleshooting).
No schema changes / migrations.
