import { useMemo, useState } from "react";
import { Search, Rocket, Ticket, ListTodo, Users, MessagesSquare, FolderKanban, Bell, Megaphone, Settings, ShieldCheck, Link2, HelpCircle, Lightbulb, LogIn, LayoutDashboard, Files, Smartphone } from "lucide-react";
import { can } from "../lib/rbac";
import "../styles/guide.css";

const Tip = ({ children }) => <div className="gd-tip"><Lightbulb size={16} /><span>{children}</span></div>;
const Steps = ({ items }) => <ol className="gd-steps">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;

const SECTIONS = (me) => [
  { id: "start", title: "What is Tendrils", icon: Rocket, keys: "overview platform introduction",
    body: (<>
      <p>Tendrils is one workspace where your team and your clients manage work together. Everything is built around a few simple things:</p>
      <ul>
        <li><b>Tickets</b> are requests or problems. Each has an owner team, an assignee, a priority and a status.</li>
        <li><b>Tasks</b> are the actual to-dos, either linked to a ticket or standalone. They can have subtasks.</li>
        <li><b>Teams</b> (IT, Design, etc.) own work, so the right people see the right things.</li>
        <li><b>Projects and Clients</b> group work by client, with milestones and updates the client can see.</li>
        <li><b>Chat, Notes, Reminders and Documents</b> keep conversations and personal context in one place.</li>
        <li><b>Notifications</b> reach you in the app, by email and optionally on WhatsApp.</li>
      </ul>
      <p>The sidebar on the left opens each area. The top bar has search (on Tickets and Tasks), the <b>bell</b> for notifications, the <b>megaphone</b> to broadcast or ping people, and this <b>Guide</b>.</p>
    </>) },
  { id: "signin", title: "Signing in, roles and modes", icon: LogIn, keys: "login employee client role permission admin switch",
    body: (<>
      <p>You sign in with Google using an invited email. Your role decides what you see:</p>
      <ul>
        <li><b>Platform admin</b>: everything, including the Admin console, roles, and messaging everyone.</li>
        <li><b>Employee</b>: tickets, tasks, teams, chat, notes and reminders for the teams you belong to.</li>
        <li><b>Client admin / Client member</b>: the client portal: raise tickets, follow progress, review work, see project updates.</li>
      </ul>
      <p>If the same email is both an employee and a client, you are asked after sign-in: <b>Continue as Employee</b> or <b>Continue as Client</b>. You can switch any time from the button under your name in the sidebar or in Settings, Account. Each side shows only its own data.</p>
      <Tip>Your exact permissions are listed in Settings, Access.</Tip>
    </>) },
  { id: "overview", title: "Overview dashboard", icon: LayoutDashboard, keys: "home dashboard summary recent activity",
    body: (<><p>The home page summarises what needs attention: open and overdue work, client delivery, and recent activity (the latest few items, with &quot;Show more&quot;). Click any card or row to jump straight into the ticket or task.</p></>) },
  { id: "tickets", title: "Tickets: create and find", icon: Ticket, keys: "ticket create new number filter my tickets priority team assignee due date attachment",
    body: (<>
      <Steps items={[
        "Open Tickets and click New ticket.",
        "Write a clear title and a description. Right below the description you can attach files (you can also paste screenshots).",
        "Pick the priority (Low, Medium, High, Urgent) and the owning team. Add other participating teams if they need to help.",
        "Optionally choose an assignee from the selected team, a project and a due date. A due date cannot be in the past.",
        "Create. The ticket gets a permanent number such as TEN-0001 (organisation prefix plus a running number). Everyone in the chosen teams is notified by email and in-app.",
      ]} />
      <p><b>Finding tickets.</b> The Tickets page opens on <b>My tickets &amp; tasks</b>: tickets assigned to you, tickets you raised, and tickets routed to your team that nobody has picked up yet (every team member sees those). Use the filters for <b>All</b>, <b>Unrouted</b> and <b>Overdue</b>, and the search box at the top.</p>
      <Tip>If a ticket is routed to your team with no assignee, open it and assign it to yourself to start. That tells everyone it is being handled.</Tip>
    </>) },
  { id: "ticketwin", title: "Inside a ticket", icon: Ticket, keys: "comments route history files flag remind linked task rename internal note created by",
    body: (<>
      <p>Click a ticket to open its window. The header shows the number, status and priority. Under the title you see who raised it and when, then the description card with a shortcut to its attachments.</p>
      <ul>
        <li><b>Right panel (always visible):</b> <b>Flag &amp; remind</b> to set a private reminder, <b>Add linked task</b> to branch work off the ticket, then details: created by, client, teams, assignee, priority, due date.</li>
        <li><b>Comments tab:</b> talk about the ticket. Employees can choose a normal comment (the client sees it) or an <b>Internal note</b> (employees only, shown in amber). Everyone involved gets an email for each comment.</li>
        <li><b>Route tab:</b> the story of the ticket as a tree: who created it, every status change, assignment, linked task and comment, with a summary strip on top. Older steps fold away under &quot;Show earlier steps&quot;.</li>
        <li><b>History tab:</b> a plain log of every change.</li>
        <li><b>Files tab:</b> all attachments. Drag files in or paste screenshots.</li>
      </ul>
      <p>You can <b>rename</b> a ticket with the Edit button next to the title if you raised it or work on it. Any link you type in a title, description or comment becomes clickable.</p>
    </>) },
  { id: "status", title: "Status and the review flow", icon: Ticket, keys: "status open review help test closed approve send back client team to team",
    body: (<>
      <p>A ticket moves through four statuses:</p>
      <ul>
        <li><b>Open</b> (In Progress or QA): the team is working on it.</li>
        <li><b>Review/Help</b> (Need more info): the team is waiting for details. Reply in the comments.</li>
        <li><b>Review/Test</b> (Resolved): work is done and waiting for approval.</li>
        <li><b>Closed</b>: finished.</li>
      </ul>
      <p><b>Client tickets:</b> when the team marks Review/Test, the client gets a &quot;Ready for your review&quot; card with <b>Approve</b> (closes it) and <b>Send back</b> (reopens it, with a comment saying what to change). Employees cannot close a client ticket themselves.</p>
      <p><b>Team-to-team tickets</b> (raised by an employee for another team): the same idea. The assigned team sets Review/Test, and <b>the person who raised the ticket</b> approves or sends back. Only that person (or an admin) can set Closed.</p>
      <Tip>A ticket cannot go to Review/Test or Closed while its linked tasks are still open. Finish or close the tasks first.</Tip>
    </>) },
  { id: "tasks", title: "Tasks and subtasks", icon: ListTodo, keys: "task subtask board list assign status rename due date review",
    body: (<>
      <Steps items={[
        "Open Tasks and click New task, or use Add linked task inside a ticket.",
        "Give it a title, description (attach files right under it), team, assignee(s) and due date.",
        "Move it through Backlog, To do, In progress, Blocked, Review and Done from the task window or by dragging on the board.",
        "Add subtasks to break big work into pieces. Subtasks show under their parent.",
      ]} />
      <ul>
        <li>Tasks can have <b>several assignees</b>, and can be shared with other teams (their members are notified).</li>
        <li><b>Rename</b> a task any time with the Rename button in its window.</li>
        <li>A task sent to Review is checked by the person or team who requested it: they approve or send it back, like tickets.</li>
        <li>Tickets assigned to you automatically create a matching work task for you.</li>
        <li>You see tasks assigned to you, tasks of tickets you raised or hold, tasks of your teams, and subtasks of your tasks.</li>
      </ul>
    </>) },
  { id: "teams", title: "Teams and routing", icon: Users, keys: "teams routing other teams participating members",
    body: (<>
      <p>Every ticket has an <b>owner team</b> and can include <b>participating teams</b>. People only see work for teams they belong to, plus what they raised or are assigned.</p>
      <ul>
        <li>Choosing a team on a ticket or task emails <b>every member</b> of that team (your own team and other teams alike). If the team is added later by editing, the newly added team is emailed then.</li>
        <li>To raise work for a team you are not part of you need the cross-team permission. Ask an admin if the option is missing.</li>
        <li>The Teams page lists each team, its members and what it handles.</li>
      </ul>
    </>) },
  { id: "projects", title: "Clients and projects", icon: FolderKanban, keys: "client project milestone update portal",
    body: (<>
      <p><b>Clients</b> gives each client its own space: people, tickets and projects. <b>Projects</b> track delivery with progress, milestones and updates. Employees with permission can post client-visible project updates; clients can request new projects from their portal.</p>
    </>) },
  { id: "chat", title: "Chat", icon: MessagesSquare, keys: "chat message mention reply room general",
    body: (<>
      <p>Chat has a General room and a room per project. Type <b>@name</b> to mention someone (or @all). You can reply to a message, edit or delete your own, and see delivery ticks. Links are clickable. Use chat for quick talk and comments on a ticket for anything that should stay on record.</p>
    </>) },
  { id: "resources", title: "Resources: documents, reminders, notes", icon: Files, keys: "documents reminders notes flag private",
    body: (<>
      <ul>
        <li><b>Documents</b>: shared files for the workspace.</li>
        <li><b>Reminders</b>: private flags you set on tickets or tasks (Flag &amp; remind). Only you see them.</li>
        <li><b>My notes</b>: private notes that are never emailed or shared.</li>
      </ul>
    </>) },
  { id: "notify", title: "Notifications, email and WhatsApp", icon: Bell, keys: "notification bell email whatsapp official email unread clear",
    body: (<>
      <p>Click the <b>bell</b> to open your notifications. It opens on Unread; switch to All, mark all as read, or Clear read. Identical notifications are merged, for example &quot;(x3)&quot;, and old read ones disappear by themselves.</p>
      <ul>
        <li><b>Email:</b> sent to your <b>official email</b> if you set one in Settings, Notifications, otherwise to your sign-in email. You get mail for assignments, comments (including internal notes if you are an employee), status changes, send-backs, teams you were added to, announcements and reminders.</li>
        <li><b>WhatsApp:</b> link your number in Settings, Notifications to receive alerts on your phone and to reply with simple commands such as <b>tasks</b>, <b>tickets</b> or <b>done 2</b>.</li>
      </ul>
      <Tip>No emails? First check Settings, Notifications for your official email, then ask an admin to confirm the mail server is configured.</Tip>
    </>) },
  { id: "broadcast", title: "Broadcast and ping", icon: Megaphone, keys: "broadcast announcement ping message everyone team person",
    body: (<>
      <p>The <b>megaphone</b> in the top bar sends a message straight to people, by notification and email, without opening a chat.</p>
      <Steps items={[
        "Click the megaphone.",
        "Choose who: Everyone (admins only), one or more Teams, or specific People. For People you can filter by team and search by name.",
        "Write a short title and the message. Links become clickable. Tick Mark as urgent if it cannot wait, and untick Also send email if you only want an in-app ping.",
        "Send. You see how many people received it.",
      ]} />
      <p>Messages appear in each person&apos;s bell. Please keep them useful: there is a limit of 20 messages per hour per person.</p>
    </>) },
  { id: "settings", title: "Settings", icon: Settings, keys: "settings account access integrations security mcp whatsapp",
    body: (<>
      <ul>
        <li><b>Account:</b> your profile, workspaces and teams, and the Employee/Client switch.</li>
        <li><b>Notifications:</b> official email and WhatsApp.</li>
        <li><b>Access:</b> your permissions grouped by area.</li>
        <li><b>Integrations:</b> connect Claude Desktop or Claude Code with a personal token (MCP) to work with Tendrils in plain language, using only your own permissions.</li>
        <li><b>Security:</b> how access and data are protected.</li>
      </ul>
    </>) },
  ...(can(me, "admin.view") ? [{ id: "admin", title: "Admin console (admins)", icon: ShieldCheck, keys: "admin invite roles members workload",
    body: (<>
      <p>Admins can invite people, set roles and team membership, see workload and activity across the team, manage WhatsApp, and message everyone. Revoking a membership removes access immediately. Review the Activity log for a traceable timeline of changes.</p>
    </>) }] : []),
  { id: "links", title: "Links, attachments and screenshots", icon: Link2, keys: "link url attachment paste screenshot file upload",
    body: (<>
      <p>Any web address (starting with http, https or www) is clickable everywhere: titles, descriptions, comments, chat, notes, notifications and emails. Attach files in the create form or the Files tab, or paste a screenshot straight into a description or comment box.</p>
    </>) },
  { id: "tips", title: "Working effectively", icon: Lightbulb, keys: "tips best practice habits",
    body: (<ul>
      <li>Start your day on Tickets, My tickets &amp; tasks, and sort out Overdue first.</li>
      <li>Write titles that say what is wrong or needed. Put steps, links and screenshots in the description.</li>
      <li>Always keep the status honest. Use Review/Help the moment you are blocked on information, and Review/Test as soon as work is done.</li>
      <li>Use internal notes for team-only context and normal comments for anything the client should read.</li>
      <li>Break big tickets into linked tasks so each person owns one clear piece.</li>
      <li>Set realistic due dates (never in the past) and update them in the ticket if plans change.</li>
      <li>Use the megaphone for urgent, important messages only. Use chat for casual talk.</li>
    </ul>) },
  { id: "faq", title: "Troubleshooting", icon: HelpCircle, keys: "faq problem help cannot close email missing ticket not visible due date",
    body: (<ul>
      <li><b>I cannot close a ticket.</b> Client tickets need the client&apos;s approval, and team-to-team tickets need the person who raised them. Set Review/Test and they will be notified.</li>
      <li><b>It says the due date cannot be in the past.</b> Pick today or a later date. Existing overdue dates can stay as they are.</li>
      <li><b>I cannot see a ticket.</b> You only see tickets for your teams, ones you raised and ones assigned to you. Ask the team or an admin to add you.</li>
      <li><b>I did not get an email.</b> Check your official email in Settings, Notifications and your spam folder. Notifications always still appear in the bell.</li>
      <li><b>I do not see Broadcast.</b> Your role may not allow it. Ask an admin.</li>
    </ul>) },
];

export default function GuidePage({ me }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => SECTIONS(me), [me]);
  const list = all.filter((s) => !q || `${s.title} ${s.keys}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="gd-wrap">
      <aside className="gd-toc" aria-label="Guide sections">
        <label className="gd-search"><Search size={15} /><input placeholder="Search the guide" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {list.map((s) => <a key={s.id} href={`#gd-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`gd-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><s.icon size={15} /> {s.title}</a>)}
        {!list.length && <small>No matching topic.</small>}
      </aside>
      <div className="gd-main">
        <div className="gd-hero"><Smartphone size={22} /><span><b>Welcome to Tendrils</b><small>A quick, complete tour of every feature and how to use it well. Use the list to jump to a topic.</small></span></div>
        {list.map((s) => (
          <section className="gd-card" id={`gd-${s.id}`} key={s.id}>
            <h2><s.icon size={20} /> {s.title}</h2>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  );
}
