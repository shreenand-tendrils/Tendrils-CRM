import { LayoutDashboard, Building2, FolderKanban, Ticket, ListTodo, Users, Activity, Bell, Settings, MessagesSquare, ClipboardCheck, ShieldCheck, Files, Lock, Flag } from "lucide-react";

// staff: hidden from client users (the API also enforces this)
export const primaryNavigation = [
  { label: "Overview", to: "/", icon: LayoutDashboard },
  { label: "Projects", to: "/projects", icon: FolderKanban },
  { label: "Tickets", to: "/tickets", icon: Ticket },
  { label: "Tasks", to: "/tasks", icon: ListTodo, staff: true },
  { label: "Chat", to: "/chat", icon: MessagesSquare, staff: true },
  { label: "Clients", to: "/clients", icon: Building2, staff: true },
  { label: "Documents", to: "/documents", icon: Files },
  { label: "Teams", to: "/teams", icon: Users, staff: true },
  { label: "Reminders", to: "/reminders", icon: Flag, staff: true },
  { label: "My notes", to: "/notes", icon: Lock, staff: true },
];
export const adminNavigation = [{ label: "Admin console", to: "/admin", icon: ShieldCheck }];
export const utilityNavigation = [{ label: "Activity log", to: "/activity", icon: Activity }, { label: "Notifications", to: "/notifications", icon: Bell }, { label: "Settings", to: "/settings", icon: Settings }];
